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
        try
        {
            await _flush(batch, CancellationToken.None).ConfigureAwait(false);
            _counters.Batch();
            _counters.Committed(batch.Count);
            Complete(batch, WriteResult.Committed);
        }
        catch (SqlException ex) when (ex.Number is 2627 or 2601)
        {
            _counters.Duplicates(batch.Count);
            Complete(batch, WriteResult.Duplicate);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"batch flush failed rows={batch.Count} error={ex.GetType().Name} message={ex.Message}");
            _counters.Failed(batch.Count);
            Complete(batch, WriteResult.Failed);
        }
    }

    private static void Complete(List<PendingEvent> batch, WriteResult result)
    {
        foreach (var pending in batch)
        {
            pending.Completion.TrySetResult(result);
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
        var table = new DataTable();
        table.Columns.Add("id", typeof(Guid));
        table.Columns.Add("source_id", typeof(string));
        table.Columns.Add("event_timestamp", typeof(DateTime));
        table.Columns.Add("payload", typeof(string));
        table.Columns.Add("received_at", typeof(DateTime));
        foreach (var pending in batch)
        {
            table.Rows.Add(
                pending.Event.Id,
                pending.Event.SourceId,
                UnspecifiedUtc(pending.Event.Timestamp.UtcDateTime),
                pending.Event.Payload,
                UnspecifiedUtc(pending.ReceivedAtUtc));
        }

        await using var connection = new SqlConnection(options.ConnectionString(options.Database));
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        using var bulk = new SqlBulkCopy(connection, SqlBulkCopyOptions.UseInternalTransaction, null)
        {
            DestinationTableName = "dbo.ingest_events",
            BatchSize = batch.Count,
            BulkCopyTimeout = 30,
        };
        bulk.ColumnMappings.Add("id", "id");
        bulk.ColumnMappings.Add("source_id", "source_id");
        bulk.ColumnMappings.Add("event_timestamp", "event_timestamp");
        bulk.ColumnMappings.Add("payload", "payload");
        bulk.ColumnMappings.Add("received_at", "received_at");
        await bulk.WriteToServerAsync(table, cancellationToken).ConfigureAwait(false);
    }

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
                INSERT INTO dbo.ingest_events (id, source_id, event_timestamp, payload, received_at)
                VALUES (@id, @source_id, @event_timestamp, @payload, @received_at)
                """,
                connection)
            {
                CommandTimeout = 10,
            };
            command.Parameters.Add("@id", SqlDbType.UniqueIdentifier).Value = ev.Id;
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
            return WriteResult.Duplicate;
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
