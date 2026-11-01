using System.Reflection;
using System.Text;
using Microsoft.Data.SqlClient;

namespace MssqlIngest;

public static class Schema
{
    public static async Task ApplyAsync(IngestOptions options, CancellationToken cancellationToken)
    {
        var databaseSql = ReadResource("schema.001_database.sql");
        var tableSql = ReadResource("schema.002_events.sql");
        Exception? last = null;
        for (var attempt = 1; attempt <= 30; attempt++)
        {
            try
            {
                await ExecuteBatchesAsync(options.ConnectionString("master"), databaseSql, cancellationToken)
                    .ConfigureAwait(false);
                await ExecuteBatchesAsync(options.ConnectionString(options.Database), tableSql, cancellationToken)
                    .ConfigureAwait(false);
                return;
            }
            catch (Exception ex) when (ex is SqlException or TimeoutException or InvalidOperationException)
            {
                last = ex;
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken).ConfigureAwait(false);
            }
        }

        throw new InvalidOperationException("schema apply failed after retries", last);
    }

    public static async Task<string> CountAsync(IngestOptions options, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(options.ConnectionString(options.Database));
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = new SqlCommand(
            """
            SELECT COUNT_BIG(*) AS row_count, COUNT_BIG(DISTINCT vantr) AS distinct_ids
            FROM dbo.ingest_events
            """,
            connection)
        {
            CommandTimeout = 60,
        };
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            return "rows=0\ndistinct_ids=0";
        }

        return $"rows={reader.GetInt64(0)}\ndistinct_ids={reader.GetInt64(1)}";
    }

    public static async Task TruncateAsync(IngestOptions options, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(options.ConnectionString(options.Database));
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = new SqlCommand("TRUNCATE TABLE dbo.ingest_events", connection)
        {
            CommandTimeout = 60,
        };
        await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
    }

    public static async Task<string> InfoAsync(IngestOptions options, CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(options.ConnectionString("master"));
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = new SqlCommand(
            """
            SELECT d.recovery_model_desc,
                   d.delayed_durability_desc,
                   d.is_read_committed_snapshot_on,
                   CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)),
                   CAST(SERVERPROPERTY('Edition') AS nvarchar(128))
            FROM sys.databases AS d
            WHERE d.name = @name
            """,
            connection);
        command.Parameters.AddWithValue("@name", options.Database);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            throw new InvalidOperationException("ingest database is missing");
        }

        return string.Join(
            '\n',
            $"recovery_model={reader.GetString(0)}",
            $"delayed_durability={reader.GetString(1)}",
            $"read_committed_snapshot={reader.GetBoolean(2)}",
            $"product_version={reader.GetString(3)}",
            $"edition={reader.GetString(4)}");
    }

    private static async Task ExecuteBatchesAsync(
        string connectionString,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        foreach (var batch in SplitBatches(sql))
        {
            await using var command = new SqlCommand(batch, connection) { CommandTimeout = 60 };
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }
    }

    internal static IEnumerable<string> SplitBatches(string sql)
    {
        var current = new StringBuilder();
        using var reader = new StringReader(sql);
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            if (line.Trim().Equals("GO", StringComparison.OrdinalIgnoreCase))
            {
                var batch = current.ToString().Trim();
                if (batch.Length > 0)
                {
                    yield return batch;
                }

                current.Clear();
                continue;
            }

            current.AppendLine(line);
        }

        var last = current.ToString().Trim();
        if (last.Length > 0)
        {
            yield return last;
        }
    }

    private static string ReadResource(string name)
    {
        var assembly = typeof(Schema).Assembly;
        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"missing embedded resource {name}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
