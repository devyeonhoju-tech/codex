namespace MssqlIngest;

public enum WriteMode
{
    Batch,
    Single,
}

public enum WriteResult
{
    Committed,
    Duplicate,
    Rejected,
    Failed,
}

public sealed class IngestEvent
{
    public Guid Id { get; set; }
    public string? SourceId { get; set; }
    public DateTimeOffset Timestamp { get; set; }
    public string? Payload { get; set; }
}

public sealed class PendingEvent
{
    public required IngestEvent Event { get; init; }
    public required DateTime ReceivedAtUtc { get; init; }
    public TaskCompletionSource<WriteResult> Completion { get; } =
        new(TaskCreationOptions.RunContinuationsAsynchronously);
}

public sealed class IngestOptions
{
    public const string ThrowawayPassword = "Ingest_Local_Dev1!";
    public const int MaxPayloadUnits = 1024;
    public const int MaxSourceUnits = 128;

    public string Host { get; init; } = "127.0.0.1";
    public int Port { get; init; } = 1433;
    public string Database { get; init; } = "ingest";
    public string User { get; init; } = "sa";
    public string Password { get; init; } = ThrowawayPassword;
    public bool PasswordIsThrowaway { get; init; } = true;
    public WriteMode Mode { get; init; } = WriteMode.Batch;
    public int BatchSize { get; init; } = 128;
    public int FlushMilliseconds { get; init; } = 10;
    public int Writers { get; init; } = 2;
    public int QueueCapacity { get; init; } = 16384;
    public int MaxPoolSize { get; init; } = 128;

    public string ConnectionString(string database)
    {
        var builder = new Microsoft.Data.SqlClient.SqlConnectionStringBuilder
        {
            DataSource = $"{Host},{Port}",
            InitialCatalog = database,
            UserID = User,
            Password = Password,
            Encrypt = true,
            TrustServerCertificate = true,
            MaxPoolSize = MaxPoolSize,
            MinPoolSize = Math.Min(Mode == WriteMode.Batch ? Writers : 4, MaxPoolSize),
            ConnectTimeout = 15,
            Pooling = true,
            ApplicationName = "mssql-ingest-dotnet",
            PacketSize = Mode == WriteMode.Batch ? 32767 : 8000,
        };
        return builder.ConnectionString;
    }

    public static IngestOptions FromEnvironment()
    {
        var password = Environment.GetEnvironmentVariable("MSSQL_PASSWORD");
        if (string.IsNullOrEmpty(password))
        {
            password = ThrowawayPassword;
        }

        var modeText = Environment.GetEnvironmentVariable("INGEST_WRITE_MODE");
        var mode = modeText?.Trim().ToLowerInvariant() switch
        {
            null or "" or "batch" => WriteMode.Batch,
            "single" => WriteMode.Single,
            _ => throw new InvalidOperationException("INGEST_WRITE_MODE must be batch or single"),
        };

        return new IngestOptions
        {
            Host = ReadString("MSSQL_HOST", "127.0.0.1"),
            Port = ReadInt("MSSQL_PORT", 1433),
            Database = ReadString("MSSQL_DATABASE", "ingest"),
            User = ReadString("MSSQL_USER", "sa"),
            Password = password,
            PasswordIsThrowaway = password == ThrowawayPassword,
            Mode = mode,
            BatchSize = Math.Clamp(ReadInt("INGEST_BATCH_SIZE", 128), 1, 1000),
            FlushMilliseconds = Math.Clamp(ReadInt("INGEST_FLUSH_MS", 10), 1, 5000),
            Writers = Math.Clamp(ReadInt("INGEST_WRITERS", 2), 1, 16),
            QueueCapacity = Math.Clamp(ReadInt("INGEST_QUEUE_CAPACITY", 16384), 1, 1_000_000),
            MaxPoolSize = Math.Clamp(ReadInt("INGEST_MAX_POOL_SIZE", 128), 1, 512),
        };
    }

    private static string ReadString(string name, string fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static int ReadInt(string name, int fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return int.TryParse(value, out var parsed) ? parsed : fallback;
    }
}

public static class IngestValidation
{
    public static bool TryValidate(IngestEvent? ev, out string error)
    {
        if (ev is null)
        {
            error = "invalid_json";
            return false;
        }

        if (ev.Id == Guid.Empty)
        {
            error = "invalid_id";
            return false;
        }

        if (string.IsNullOrWhiteSpace(ev.SourceId))
        {
            error = "invalid_source";
            return false;
        }

        ev.SourceId = ev.SourceId.Trim();
        if (ev.SourceId.Length > IngestOptions.MaxSourceUnits || ev.SourceId.Contains('\0'))
        {
            error = "invalid_source";
            return false;
        }

        if (ev.Timestamp == default || ev.Timestamp.Year < 1970)
        {
            error = "invalid_timestamp";
            return false;
        }

        if (ev.Payload is null)
        {
            error = "missing_payload";
            return false;
        }

        if (ev.Payload.Length > IngestOptions.MaxPayloadUnits)
        {
            error = "payload_too_large";
            return false;
        }

        error = "";
        return true;
    }
}

public sealed class IngestCounters
{
    private long _accepted;
    private long _rejected;
    private long _committed;
    private long _duplicates;
    private long _failed;
    private long _batches;
    private int _queueDepth;

    public void Accepted() => Interlocked.Increment(ref _accepted);
    public void Rejected() => Interlocked.Increment(ref _rejected);
    public void Committed(int rows) => Interlocked.Add(ref _committed, rows);
    public void Duplicates(int rows) => Interlocked.Add(ref _duplicates, rows);
    public void Failed(int rows) => Interlocked.Add(ref _failed, rows);
    public void Batch() => Interlocked.Increment(ref _batches);
    public void QueueDepth(int depth) => Volatile.Write(ref _queueDepth, depth);

    public object Snapshot(IngestOptions options) => new
    {
        service = "dotnet",
        mode = options.Mode == WriteMode.Batch ? "batch" : "single",
        batchSize = options.BatchSize,
        flushIntervalMs = options.FlushMilliseconds,
        writers = options.Writers,
        queueCapacity = options.QueueCapacity,
        maxPoolSize = options.MaxPoolSize,
        queueDepth = Volatile.Read(ref _queueDepth),
        accepted = Interlocked.Read(ref _accepted),
        rejected = Interlocked.Read(ref _rejected),
        committed = Interlocked.Read(ref _committed),
        duplicates = Interlocked.Read(ref _duplicates),
        failed = Interlocked.Read(ref _failed),
        batches = Interlocked.Read(ref _batches),
        acknowledgement = "after_commit",
    };
}
