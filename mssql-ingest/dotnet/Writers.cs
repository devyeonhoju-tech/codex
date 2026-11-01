using System.Data;
using System.Threading.Channels;
using Microsoft.Data.SqlClient;

namespace MssqlIngest;

public delegate Task BatchFlush(IReadOnlyList<PendingEvent> batch, CancellationToken cancellationToken);

public sealed class BatchIngestWriter : BackgroundService
{
    private readonly IngestOptions _options;
    private readonly IngestCounters _counters;
    private readonly BatchFlush _flush;
    private readonly Channel<PendingEvent> _channel;

    public BatchIngestWriter(IngestOptions options, IngestCounters counters)
        : this(options, counters, (batch, cancellationToken) => SqlBulkFlush.FlushAsync(options, batch, cancellationToken))
    {
    }

    public BatchIngestWriter(IngestOptions options, IngestCounters counters, BatchFlush flush)
    {
        _options = options;
        _counters = counters;
        _flush = flush;
        _channel = Channel.CreateBounded<PendingEvent>(new BoundedChannelOptions(options.QueueCapacity)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = false,
            SingleWriter = false,
        });
    }

    public int LiveQueueDepth => _channel.Reader.CanCount ? _channel.Reader.Count : 0;

    public bool TrySubmit(IngestEvent ev, out Task<WriteResult> completion)
    {
        var pending = new PendingEvent
        {
            Event = ev,
            ReceivedAtUtc = DateTime.UtcNow,
        };
        if (!_channel.Writer.TryWrite(pending))
        {
            _counters.Rejected();
            _counters.QueueDepth(_channel.Reader.Count);
            completion = Task.FromResult(WriteResult.Rejected);
            return false;
        }

        _counters.Accepted();
        _counters.QueueDepth(_channel.Reader.Count);
        completion = pending.Completion.Task;
        return true;
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _channel.Writer.TryComplete();
        await base.StopAsync(cancellationToken).ConfigureAwait(false);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var workers = new Task[_options.Writers];
        for (var i = 0; i < workers.Length; i++)
        {
            workers[i] = Task.Run(() => WorkerAsync(stoppingToken));
        }

        await Task.WhenAll(workers).ConfigureAwait(false);
    }

    private async Task WorkerAsync(CancellationToken stoppingToken)
    {
        while (true)
        {
            try
            {
                if (!await _channel.Reader.WaitToReadAsync(stoppingToken).ConfigureAwait(false))
                {
                    break;
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }

            if (!_channel.Reader.TryRead(out var first))
            {
                continue;
            }

            var batch = new List<PendingEvent>(_options.BatchSize) { first };
            var start = System.Diagnostics.Stopwatch.GetTimestamp();
            var flushWindow = TimeSpan.FromMilliseconds(_options.FlushMilliseconds);
            while (batch.Count < _options.BatchSize)
            {
                while (batch.Count < _options.BatchSize && _channel.Reader.TryRead(out var more))
                {
                    batch.Add(more);
                }

                if (batch.Count >= _options.BatchSize)
                {
                    break;
                }

                var remaining = flushWindow - System.Diagnostics.Stopwatch.GetElapsedTime(start);
                if (remaining <= TimeSpan.Zero)
                {
                    break;
                }

                using var wait = CancellationTokenSource.CreateLinkedTokenSource(stoppingToken);
                wait.CancelAfter(remaining);
                try
                {
                    if (!await _channel.Reader.WaitToReadAsync(wait.Token).ConfigureAwait(false))
                    {
                        break;
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }

            await FlushOneAsync(batch).ConfigureAwait(false);
        }

        var rest = new List<PendingEvent>(_options.BatchSize);
        while (_channel.Reader.TryRead(out var item))
        {
            rest.Add(item);
            if (rest.Count >= _options.BatchSize)
            {
                await FlushOneAsync(rest).ConfigureAwait(false);
                rest = new List<PendingEvent>(_options.BatchSize);
            }
        }

        if (rest.Count > 0)
        {
            await FlushOneAsync(rest).ConfigureAwait(false);
        }
    }

    private async Task FlushOneAsync(List<PendingEvent> batch)
    {
        var groups = batch
            .GroupBy(pending => pending.Event.Vantr ?? "", StringComparer.Ordinal)
            .ToList();
        var distinct = groups.Select(group => group.First()).ToList();
        WriteResult[] results;
        try
        {
            results = await BatchIsolator.IsolateAsync(
                distinct.Count,
                (start, count, cancellationToken) => _flush(distinct.GetRange(start, count), cancellationToken),
                async (index, cancellationToken) =>
                    await SqlBulkFlush.ExistsAsync(_options, distinct[index].Event.Vantr!, cancellationToken)
                        .ConfigureAwait(false),
                SqlBulkFlush.IsFatal,
                CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"batch isolate failed rows={batch.Count} error={ex.GetType().Name} message={ex.Message}");
            results = Enumerable.Repeat(WriteResult.Failed, distinct.Count).ToArray();
        }

        _counters.Batch();
        for (var i = 0; i < groups.Count; i++)
        {
            var result = results[i];
            var waiters = groups[i].Count();
            if (result is WriteResult.Committed or WriteResult.Duplicate)
            {
                _counters.Committed(waiters);
            }
            else
            {
                _counters.Failed(waiters);
            }

            foreach (var pending in groups[i])
            {
                pending.Completion.TrySetResult(result);
            }
        }
    }
}

public static class SqlBulkFlush
{
    public static async Task FlushAsync(
        IngestOptions options,
        IReadOnlyList<PendingEvent> batch,
        CancellationToken cancellationToken)
    {
        if (batch.Count == 0)
        {
            return;
        }

        var table = new DataTable();
        table.Columns.Add("vantr", typeof(string));
        table.Columns.Add("source_id", typeof(string));
        table.Columns.Add("event_timestamp", typeof(DateTime));
        table.Columns.Add("payload", typeof(string));
        table.Columns.Add("received_at", typeof(DateTime));
        foreach (var pending in batch)
        {
            table.Rows.Add(
                pending.Event.Vantr,
                pending.Event.SourceId,
                UnspecifiedUtc(pending.Event.Timestamp.UtcDateTime),
                pending.Event.Payload,
                UnspecifiedUtc(pending.ReceivedAtUtc));
        }

        await using var connection = new SqlConnection(options.ConnectionString(options.Database));
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var transaction = (SqlTransaction)await connection.BeginTransactionAsync(cancellationToken)
            .ConfigureAwait(false);
        await using (var create = new SqlCommand(
            """
            CREATE TABLE #ingest_stage (
                vantr NVARCHAR(128) NOT NULL,
                source_id NVARCHAR(128) NOT NULL,
                event_timestamp DATETIME2(3) NOT NULL,
                payload NVARCHAR(1024) NOT NULL,
                received_at DATETIME2(3) NOT NULL
            );
            """,
            connection,
            transaction))
        {
            await create.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        using (var bulk = new SqlBulkCopy(connection, SqlBulkCopyOptions.Default, transaction)
        {
            DestinationTableName = "#ingest_stage",
            BatchSize = batch.Count,
            BulkCopyTimeout = 30,
        })
        {
            bulk.ColumnMappings.Add("vantr", "vantr");
            bulk.ColumnMappings.Add("source_id", "source_id");
            bulk.ColumnMappings.Add("event_timestamp", "event_timestamp");
            bulk.ColumnMappings.Add("payload", "payload");
            bulk.ColumnMappings.Add("received_at", "received_at");
            await bulk.WriteToServerAsync(table, cancellationToken).ConfigureAwait(false);
        }

        await using (var insert = new SqlCommand(
            """
            INSERT INTO dbo.ingest_events (vantr, source_id, event_timestamp, payload, received_at)
            SELECT s.vantr, s.source_id, s.event_timestamp, s.payload, s.received_at
            FROM #ingest_stage AS s
            WHERE NOT EXISTS (
                SELECT 1 FROM dbo.ingest_events AS t WHERE t.vantr = s.vantr
            );
            """,
            connection,
            transaction)
        {
            CommandTimeout = 30,
        })
        {
            await insert.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
    }

    public static async Task<bool> ExistsAsync(
        IngestOptions options,
        string vantr,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(options.ConnectionString(options.Database));
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = new SqlCommand(
            "SELECT 1 FROM dbo.ingest_events WHERE vantr = @vantr",
            connection)
        {
            CommandTimeout = 5,
        };
        command.Parameters.Add("@vantr", SqlDbType.NVarChar, IngestOptions.MaxVantrUnits).Value = vantr;
        var found = await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return found is not null;
    }

    public static bool IsFatal(Exception exception) =>
        exception is SqlException sql && sql.Number is -2 or 53 or 233 or 10053 or 10054 or 10060
        || exception is TimeoutException;

    private static DateTime UnspecifiedUtc(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Unspecified);
}

public sealed class SingleIngestWriter
{
    private readonly IngestOptions _options;
    private readonly IngestCounters _counters;
    private readonly SemaphoreSlim _slots;

    public SingleIngestWriter(IngestOptions options, IngestCounters counters)
    {
        _options = options;
        _counters = counters;
        _slots = new SemaphoreSlim(options.MaxPoolSize, options.MaxPoolSize);
    }

    public int LiveQueueDepth => _options.MaxPoolSize - _slots.CurrentCount;

    public async Task<WriteResult> InsertAsync(IngestEvent ev, CancellationToken cancellationToken)
    {
        if (!await _slots.WaitAsync(TimeSpan.Zero, cancellationToken).ConfigureAwait(false))
        {
            _counters.Rejected();
            _counters.QueueDepth(_options.MaxPoolSize - _slots.CurrentCount);
            return WriteResult.Rejected;
        }

        _counters.Accepted();
        _counters.QueueDepth(_options.MaxPoolSize - _slots.CurrentCount);
        try
        {
            await using var connection = new SqlConnection(_options.ConnectionString(_options.Database));
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            await using var command = new SqlCommand(
                """
                INSERT INTO dbo.ingest_events (vantr, source_id, event_timestamp, payload, received_at)
                SELECT @vantr, @source_id, @event_timestamp, @payload, @received_at
                WHERE NOT EXISTS (SELECT 1 FROM dbo.ingest_events WHERE vantr = @vantr);
                """,
                connection)
            {
                CommandTimeout = 10,
            };
            command.Parameters.Add("@vantr", SqlDbType.NVarChar, IngestOptions.MaxVantrUnits).Value = ev.Vantr;
            command.Parameters.Add("@source_id", SqlDbType.NVarChar, IngestOptions.MaxSourceUnits).Value = ev.SourceId;
            command.Parameters.Add("@event_timestamp", SqlDbType.DateTime2).Value =
                DateTime.SpecifyKind(ev.Timestamp.UtcDateTime, DateTimeKind.Unspecified);
            command.Parameters.Add("@payload", SqlDbType.NVarChar, IngestOptions.MaxPayloadUnits).Value = ev.Payload;
            command.Parameters.Add("@received_at", SqlDbType.DateTime2).Value =
                DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified);
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
            _counters.Committed(1);
            return WriteResult.Committed;
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601)
        {
            _counters.Duplicates(1);
            _counters.Committed(1);
            return WriteResult.Committed;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"single insert failed error={ex.GetType().Name} message={ex.Message}");
            _counters.Failed(1);
            return WriteResult.Failed;
        }
        finally
        {
            _slots.Release();
            _counters.QueueDepth(_options.MaxPoolSize - _slots.CurrentCount);
        }
    }
}
