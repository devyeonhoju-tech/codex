using System.Text.Json;
using MssqlIngest;

var options = IngestOptions.FromEnvironment();
var command = args.FirstOrDefault()?.ToLowerInvariant();
if (command is "count" or "truncate" or "info")
{
    await Schema.ApplyAsync(options, CancellationToken.None).ConfigureAwait(false);
    var text = command switch
    {
        "count" => await Schema.CountAsync(options, CancellationToken.None).ConfigureAwait(false),
        "truncate" => await TruncateAsync().ConfigureAwait(false),
        "info" => await Schema.InfoAsync(options, CancellationToken.None).ConfigureAwait(false),
        _ => "",
    };
    Console.WriteLine(text);
    return;

    async Task<string> TruncateAsync()
    {
        await Schema.TruncateAsync(options, CancellationToken.None).ConfigureAwait(false);
        return "truncated";
    }
}

ThreadPool.SetMinThreads(128, 128);

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Warning);

if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    var bind = Environment.GetEnvironmentVariable("BIND");
    if (string.IsNullOrWhiteSpace(bind))
    {
        bind = "127.0.0.1";
    }

    var port = Environment.GetEnvironmentVariable("PORT");
    if (string.IsNullOrWhiteSpace(port))
    {
        port = "8080";
    }

    builder.WebHost.UseUrls($"http://{bind}:{port}");
}

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.AddServerHeader = false;
    kestrel.Limits.MaxRequestBodySize = 16 * 1024;
});
builder.Services.Configure<Microsoft.AspNetCore.Server.Kestrel.Transport.Sockets.SocketTransportOptions>(
    socket => socket.NoDelay = true);

var counters = new IngestCounters();
builder.Services.AddSingleton(options);
builder.Services.AddSingleton(counters);
BatchIngestWriter? batchWriter = null;
SingleIngestWriter? singleWriter = null;
if (options.Mode == WriteMode.Batch)
{
    batchWriter = new BatchIngestWriter(options, counters);
    builder.Services.AddSingleton(batchWriter);
    builder.Services.AddHostedService(_ => batchWriter);
}
else
{
    singleWriter = new SingleIngestWriter(options, counters);
    builder.Services.AddSingleton(singleWriter);
}

var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);

try
{
    await Schema.ApplyAsync(options, CancellationToken.None).ConfigureAwait(false);
}
catch (Exception ex)
{
    Console.Error.WriteLine($"schema failed: {ex.Message}");
    Environment.ExitCode = 1;
    return;
}

var app = builder.Build();

app.MapGet("/health", () => Results.Text("ok", "text/plain"));
app.MapGet("/ready", async (CancellationToken cancellationToken) =>
{
    try
    {
        await using var connection = new Microsoft.Data.SqlClient.SqlConnection(options.ConnectionString(options.Database));
        await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        await using var command = new Microsoft.Data.SqlClient.SqlCommand("SELECT 1", connection);
        await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
        return Results.Text("ok", "text/plain");
    }
    catch (Exception ex)
    {
        return Results.Text(ex.Message, "text/plain", statusCode: StatusCodes.Status503ServiceUnavailable);
    }
});
app.MapGet("/stats", () =>
{
    var depth = batchWriter?.LiveQueueDepth ?? singleWriter?.LiveQueueDepth ?? 0;
    counters.QueueDepth(depth);
    return Results.Json(counters.Snapshot(options));
});

app.MapPost("/v1/ingest", async (HttpRequest request, CancellationToken cancellationToken) =>
{
    IngestEvent? ev;
    try
    {
        ev = await JsonSerializer.DeserializeAsync<IngestEvent>(request.Body, json, cancellationToken)
            .ConfigureAwait(false);
    }
    catch (JsonException)
    {
        return Error(StatusCodes.Status400BadRequest, "invalid_json");
    }

    if (!IngestValidation.TryValidate(ev, out var validationError))
    {
        return Error(StatusCodes.Status400BadRequest, validationError);
    }

    WriteResult result;
    if (batchWriter is not null)
    {
        if (!batchWriter.TrySubmit(ev!, out var completion))
        {
            return Error(StatusCodes.Status429TooManyRequests, "queue_full");
        }

        result = await completion.WaitAsync(cancellationToken).ConfigureAwait(false);
    }
    else
    {
        result = await singleWriter!.InsertAsync(ev!, cancellationToken).ConfigureAwait(false);
    }

    return result switch
    {
        WriteResult.Committed or WriteResult.Duplicate => Results.Json(
            new { status = "committed" },
            statusCode: StatusCodes.Status202Accepted),
        WriteResult.Rejected => Error(StatusCodes.Status429TooManyRequests, "queue_full"),
        _ => Error(StatusCodes.Status503ServiceUnavailable, "write_failed"),
    };
});

app.Lifetime.ApplicationStarted.Register(() =>
{
    Console.Error.WriteLine(
        $"listening {string.Join(",", app.Urls)} service=dotnet mode={options.Mode.ToString().ToLowerInvariant()} batch_size={options.BatchSize} flush_ms={options.FlushMilliseconds} writers={options.Writers} queue_capacity={options.QueueCapacity} max_pool={options.MaxPoolSize} acknowledgement=after_commit throwaway_password={options.PasswordIsThrowaway} pid={Environment.ProcessId}");
});

app.Run();

static IResult Error(int status, string code) =>
    Results.Json(new { error = code }, statusCode: status);
