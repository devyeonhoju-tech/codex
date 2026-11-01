namespace CryptoBench;

/// <summary>
/// Five outbound REST calls sharing one <see cref="HttpClient"/> handler pool.
/// Any timeout, transport error, or non-2xx status fails the whole fan-out.
/// </summary>
public sealed class DownstreamFanout
{
    private readonly HttpClient _http;
    private readonly string[] _urls;
    private readonly bool _sequential;
    private readonly TimeSpan _timeout;

    public DownstreamFanout(HttpClient http, IReadOnlyList<string> urls, bool sequential, TimeSpan timeout)
    {
        if (urls.Count != 5)
        {
            throw new ArgumentException("Exactly 5 downstream URLs are required.", nameof(urls));
        }

        _http = http;
        _urls = urls.ToArray();
        _sequential = sequential;
        _timeout = timeout;
    }

    public static string EndpointName(string url)
    {
        var trimmed = url.TrimEnd('/');
        int slash = trimmed.LastIndexOf('/');
        return slash >= 0 ? trimmed[(slash + 1)..] : trimmed;
    }

    public async Task<List<DownstreamSlot>?> CallAllAsync(byte[] body, CancellationToken cancellationToken)
    {
        if (_sequential)
        {
            var slots = new List<DownstreamSlot>(5);
            foreach (string url in _urls)
            {
                DownstreamSlot? slot = await CallOneAsync(url, body, cancellationToken).ConfigureAwait(false);
                if (slot is null)
                {
                    return null;
                }

                slots.Add(slot);
            }

            return slots;
        }

        DownstreamSlot?[] slotsParallel = await Task.WhenAll(
            _urls.Select(url => CallOneAsync(url, body, cancellationToken))).ConfigureAwait(false);
        if (slotsParallel.Any(slot => slot is null))
        {
            return null;
        }

        return slotsParallel.Select(slot => slot!).ToList();
    }

    private async Task<DownstreamSlot?> CallOneAsync(string url, byte[] body, CancellationToken cancellationToken)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(_timeout);
        try
        {
            using var content = new ByteArrayContent(body);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
            using var response = await _http.PostAsync(url, content, timeout.Token).ConfigureAwait(false);
            string text = await response.Content.ReadAsStringAsync(timeout.Token).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            return new DownstreamSlot(EndpointName(url), (int)response.StatusCode, text);
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        catch (HttpRequestException)
        {
            return null;
        }
    }
}
