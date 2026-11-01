using CryptoBench;
using Microsoft.AspNetCore.Server.Kestrel.Transport.Sockets;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.SetMinimumLevel(LogLevel.Warning);

string? keyHex = builder.Configuration["BENCH_AES_KEY"];
if (string.IsNullOrWhiteSpace(keyHex))
{
    Console.Error.WriteLine(
        "BENCH_AES_KEY is required (64 hex characters). The key in bench/testdata/bench_key.hex is a public benchmark key, not a secret.");
    Environment.ExitCode = 1;
    return;
}

byte[] key;
try
{
    key = CryptoEngine.ParseKey(keyHex);
}
catch (FormatException ex)
{
    Console.Error.WriteLine(ex.Message);
    Environment.ExitCode = 1;
    return;
}

if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("ASPNETCORE_URLS")))
{
    builder.WebHost.UseUrls("http://127.0.0.1:8080");
}

builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = Protocol.MaxBody;
});
builder.Services.Configure<SocketTransportOptions>(options => options.NoDelay = true);

builder.Services.AddSingleton(new CryptoEngine(key));

string[]? downstreamUrls = null;
bool downstreamSequential = false;
TimeSpan downstreamTimeout = TimeSpan.FromMilliseconds(2_000);
string? downstreamRaw = Environment.GetEnvironmentVariable("BENCH_DOWNSTREAM_URLS");
if (!string.IsNullOrWhiteSpace(downstreamRaw))
{
    downstreamUrls = downstreamRaw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    if (downstreamUrls.Length != 5)
    {
        Console.Error.WriteLine($"BENCH_DOWNSTREAM_URLS must list exactly 5 endpoints, got {downstreamUrls.Length}.");
        Environment.ExitCode = 1;
        return;
    }

    downstreamSequential = string.Equals(
        Environment.GetEnvironmentVariable("BENCH_DOWNSTREAM_MODE"),
        "sequential",
        StringComparison.OrdinalIgnoreCase);
    if (int.TryParse(Environment.GetEnvironmentVariable("BENCH_DOWNSTREAM_TIMEOUT_MS"), out int timeoutMs) && timeoutMs > 0)
    {
        downstreamTimeout = TimeSpan.FromMilliseconds(timeoutMs);
    }

    builder.Services.AddHttpClient("downstream", client =>
    {
        client.Timeout = Timeout.InfiniteTimeSpan;
    }).ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
    {
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30),
        MaxConnectionsPerServer = 2048,
        ConnectTimeout = TimeSpan.FromSeconds(2),
        EnableMultipleHttp2Connections = true,
    });
}

var app = builder.Build();

app.MapGet("/health", () => Results.Text("ok", "text/plain"));

app.MapPost("/v1/process", async (HttpRequest request, CryptoEngine crypto, CancellationToken cancellationToken) =>
{
    byte[]? body = await ReadBody(request, cancellationToken).ConfigureAwait(false);
    if (body is null)
    {
        return Error(StatusCodes.Status413PayloadTooLarge, "body_too_large");
    }

    if (!crypto.TryOpen(body, out byte[] plaintext, out string openError))
    {
        return Error(StatusCodes.Status400BadRequest, openError);
    }

    List<DownstreamSlot>? downstream = null;
    if (downstreamUrls is not null)
    {
        HttpClient http = request.HttpContext.RequestServices.GetRequiredService<IHttpClientFactory>().CreateClient("downstream");
        var fanout = new DownstreamFanout(http, downstreamUrls, downstreamSequential, downstreamTimeout);
        downstream = await fanout.CallAllAsync(plaintext, cancellationToken).ConfigureAwait(false);
        if (downstream is null)
        {
            return Error(StatusCodes.Status502BadGateway, "downstream_failed");
        }
    }

    if (!Protocol.TryProcess(plaintext, downstream, out byte[] responsePlain, out string processError))
    {
        return Error(StatusCodes.Status400BadRequest, processError);
    }

    byte[] wire = crypto.Seal(responsePlain);
    return Results.Bytes(wire, "application/octet-stream");
});

app.Lifetime.ApplicationStarted.Register(() =>
{
    var memory = GC.GetGCMemoryInfo();
    var gc = GC.GetConfigurationVariables();
    static string Show(IReadOnlyDictionary<string, object> values, string key) =>
        values.TryGetValue(key, out var value) ? value?.ToString() ?? "" : "unset";
    Console.Error.WriteLine(
        $"listening {string.Join(",", app.Urls)} processor_count={Environment.ProcessorCount} server_gc={System.Runtime.GCSettings.IsServerGC} concurrent_gc={Show(gc, "ConcurrentGC")} heap_hard_limit={Show(gc, "GCHeapHardLimit")} total_available_bytes={memory.TotalAvailableMemoryBytes} downstream={(downstreamUrls is null ? "off" : downstreamSequential ? "sequential" : "concurrent")} pid={Environment.ProcessId}");
});

app.Run();

static IResult Error(int status, string code)
{
    return Results.Text($$"""{"error":"{{code}}"}""", "application/json", statusCode: status);
}

static async Task<byte[]?> ReadBody(HttpRequest request, CancellationToken cancellationToken)
{
    if (request.ContentLength is long advertised && advertised > Protocol.MaxBody)
    {
        return null;
    }

    using var buffer = new MemoryStream(capacity: request.ContentLength is > 0 and var n
        ? (int)Math.Min(n, Protocol.MaxBody)
        : 256);
    var chunk = new byte[16 * 1024];
    int total = 0;
    while (true)
    {
        int read = await request.Body.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
            break;
        }

        total += read;
        if (total > Protocol.MaxBody)
        {
            return null;
        }

        buffer.Write(chunk, 0, read);
    }

    return buffer.ToArray();
}
