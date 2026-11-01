using System.Net;
using System.Text;

namespace CryptoBench.Tests;

public class DownstreamTests
{
    [Fact]
    public void BaselineJsonOmitsDownstream()
    {
        byte[] plain = """{"id":"hello","data":"hello","multiplier":3}"""u8.ToArray();
        Assert.True(Protocol.TryProcess(plain, out byte[] response, out string error), error);
        string json = Encoding.UTF8.GetString(response);
        Assert.DoesNotContain("downstream", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AggregatesFiveCallsInOrder()
    {
        await using var mock = await LoopbackMock.StartAsync(failName: null, delay: TimeSpan.Zero);
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        var fanout = new DownstreamFanout(http, mock.Urls, sequential: false, TimeSpan.FromSeconds(2));
        byte[] request = """{"id":"hello","data":"hello","multiplier":3}"""u8.ToArray();
        List<DownstreamSlot>? slots = await fanout.CallAllAsync(request, CancellationToken.None);
        Assert.NotNull(slots);
        Assert.Equal(["a", "b", "c", "d", "e"], slots.Select(slot => slot.Name).ToArray());
        Assert.All(slots, slot => Assert.Equal(DownstreamBodies.MockBody(slot.Name, 4), slot.Body));
        Assert.True(Protocol.TryProcess(request, slots, out byte[] response, out string error), error);
        string json = Encoding.UTF8.GetString(response);
        Assert.Contains("\"downstream\":[{\"name\":\"a\"", json, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Downstream5xxFailsTheFanout()
    {
        await using var mock = await LoopbackMock.StartAsync(failName: "c", delay: TimeSpan.Zero);
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        var fanout = new DownstreamFanout(http, mock.Urls, sequential: false, TimeSpan.FromSeconds(2));
        List<DownstreamSlot>? slots = await fanout.CallAllAsync("{\"id\":\"x\"}"u8.ToArray(), CancellationToken.None);
        Assert.Null(slots);
    }

    [Fact]
    public async Task DownstreamTimeoutFailsTheFanout()
    {
        await using var mock = await LoopbackMock.StartAsync(failName: "slow", delay: TimeSpan.FromSeconds(2));
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        var fanout = new DownstreamFanout(http, mock.Urls, sequential: true, TimeSpan.FromMilliseconds(150));
        List<DownstreamSlot>? slots = await fanout.CallAllAsync("{\"id\":\"x\"}"u8.ToArray(), CancellationToken.None);
        Assert.Null(slots);
    }

    private sealed class LoopbackMock : IAsyncDisposable
    {
        private readonly HttpListener _listener;
        private readonly CancellationTokenSource _stop = new();
        private readonly Task _loop;

        public string[] Urls { get; }

        private LoopbackMock(HttpListener listener, string[] urls)
        {
            _listener = listener;
            Urls = urls;
            _loop = Task.Run(() => ListenAsync(_stop.Token));
        }

        public static Task<LoopbackMock> StartAsync(string? failName, TimeSpan delay)
        {
            var tcp = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
            tcp.Start();
            int port = ((IPEndPoint)tcp.LocalEndpoint).Port;
            tcp.Stop();
            var listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            listener.Start();
            string[] urls = ["a", "b", "c", "d", "e"];
            string[] full = urls.Select(name => $"http://127.0.0.1:{port}/v1/{name}").ToArray();
            var mock = new LoopbackMock(listener, full);
            mock.FailName = failName;
            mock.Delay = delay;
            return Task.FromResult(mock);
        }

        private string? FailName { get; set; }
        private TimeSpan Delay { get; set; }

        private async Task ListenAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                HttpListenerContext context;
                try
                {
                    context = await _listener.GetContextAsync().WaitAsync(cancellationToken);
                }
                catch
                {
                    break;
                }

                _ = Task.Run(async () =>
                {
                    string name = context.Request.Url?.AbsolutePath.TrimEnd('/').Split('/').Last() ?? "";
                    if (FailName == "slow" && name == "e")
                    {
                        await Task.Delay(Delay);
                    }
                    else if (Delay > TimeSpan.Zero && FailName != "slow")
                    {
                        await Task.Delay(Delay);
                    }

                    byte[] payload;
                    if (FailName == name)
                    {
                        context.Response.StatusCode = 500;
                        payload = """{"error":"boom"}"""u8.ToArray();
                    }
                    else if (FailName == "slow" && name == "e")
                    {
                        context.Response.StatusCode = 200;
                        payload = """{"late":true}"""u8.ToArray();
                    }
                    else
                    {
                        context.Response.StatusCode = 200;
                        payload = Encoding.UTF8.GetBytes(DownstreamBodies.MockBody(name, 4));
                    }

                    context.Response.ContentType = "application/json";
                    await context.Response.OutputStream.WriteAsync(payload);
                    context.Response.Close();
                });
            }
        }

        public async ValueTask DisposeAsync()
        {
            _stop.Cancel();
            _listener.Stop();
            try
            {
                await _loop;
            }
            catch
            {
                // listener stopped
            }

            _stop.Dispose();
        }
    }
}
