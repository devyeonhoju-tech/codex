using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace CryptoBench;

/// <summary>
/// JSON options and the FNV-1a processing step from bench/WIRE_FORMAT.md.
/// Checksums are over UTF-8 bytes, not UTF-16 code units.
/// </summary>
public static class Protocol
{
    public const int MaxIdBytes = 256;
    public const int MaxDataBytes = 2_000_000;
    public const int MaxBody = 8 * 1024 * 1024;

    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    public static uint Fnv1a32(ReadOnlySpan<byte> data)
    {
        unchecked
        {
            uint hash = 2166136261;
            foreach (byte b in data)
            {
                hash ^= b;
                hash *= 16777619;
            }
            return hash;
        }
    }

    public static bool TryProcess(ReadOnlySpan<byte> plaintext, out byte[] response, out string error)
    {
        response = Array.Empty<byte>();
        ProcessRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<ProcessRequest>(plaintext, Json);
        }
        catch (JsonException)
        {
            error = "invalid_json";
            return false;
        }

        if (request is null || request.Id is null || request.Data is null || request.Multiplier is null)
        {
            error = "invalid_request";
            return false;
        }

        int idBytes = Encoding.UTF8.GetByteCount(request.Id);
        if (idBytes == 0 || idBytes > MaxIdBytes)
        {
            error = "invalid_request";
            return false;
        }

        int dataBytes = Encoding.UTF8.GetByteCount(request.Data);
        if (dataBytes > MaxDataBytes)
        {
            error = "invalid_request";
            return false;
        }

        byte[] utf8 = Encoding.UTF8.GetBytes(request.Data);
        uint length = (uint)utf8.Length;
        uint checksum = Fnv1a32(utf8);
        uint tag = checksum ^ request.Multiplier.Value ^ length;
        response = JsonSerializer.SerializeToUtf8Bytes(
            new ProcessResponse(request.Id, checksum, length, tag),
            Json);
        error = "";
        return true;
    }
}

public sealed class ProcessRequest
{
    public string? Id { get; set; }
    public string? Data { get; set; }
    public uint? Multiplier { get; set; }
}

public sealed record ProcessResponse(string Id, uint Checksum, uint Length, uint Tag);
