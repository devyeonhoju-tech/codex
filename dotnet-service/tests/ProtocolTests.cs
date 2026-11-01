using System.Text;
using System.Text.Json;

namespace CryptoBench.Tests;

public class ProtocolTests
{
    private static string DataPath(string name) =>
        Path.Combine(AppContext.BaseDirectory, "testdata", name);

    [Fact]
    public void ProcessVectorsMatchSharedFile()
    {
        VectorFile file = JsonSerializer.Deserialize<VectorFile>(
            File.ReadAllText(DataPath("process_vectors.json")),
            Protocol.Json)!;
        Assert.NotEmpty(file.Cases);
        foreach (VectorCase vector in file.Cases)
        {
            Assert.True(
                Protocol.TryProcess(Encoding.UTF8.GetBytes(vector.RequestJson), out byte[] response, out string error),
                error);
            Assert.Equal(vector.ResponseJson, Encoding.UTF8.GetString(response));
        }
    }

    [Fact]
    public void RejectsBadInput()
    {
        Assert.False(Protocol.TryProcess("not-json"u8, out _, out string jsonError));
        Assert.Equal("invalid_json", jsonError);

        Assert.False(Protocol.TryProcess("""{"id":"a","multiplier":1}"""u8, out _, out string missing));
        Assert.Equal("invalid_request", missing);

        Assert.False(Protocol.TryProcess("""{"id":"","data":"x","multiplier":1}"""u8, out _, out string empty));
        Assert.Equal("invalid_request", empty);

        Assert.False(Protocol.TryProcess("""{"id":"a","data":"x","multiplier":1.5}"""u8, out _, out string fraction));
        Assert.Equal("invalid_json", fraction);
    }

    [Fact]
    public void AesGcmKnownAnswersMatchPython()
    {
        KatFile file = JsonSerializer.Deserialize<KatFile>(
            File.ReadAllText(DataPath("aes_gcm_kat.json")),
            Protocol.Json)!;
        using var crypto = new CryptoEngine(CryptoEngine.ParseKey(file.KeyHex));
        foreach (KatCase vector in file.Cases)
        {
            byte[] nonce = Convert.FromHexString(vector.NonceHex);
            byte[] plaintext = Convert.FromHexString(vector.PlaintextHex);
            byte[] wire = crypto.SealWithNonce(nonce, plaintext);
            Assert.Equal(vector.NonceHex, Convert.ToHexString(wire.AsSpan(0, 12)).ToLowerInvariant());
            Assert.Equal(
                vector.CiphertextHex,
                Convert.ToHexString(wire.AsSpan(12, plaintext.Length)).ToLowerInvariant());
            Assert.Equal(
                vector.TagHex,
                Convert.ToHexString(wire.AsSpan(wire.Length - 16, 16)).ToLowerInvariant());
            Assert.True(crypto.TryOpen(wire, out byte[] opened, out string error), error);
            Assert.Equal(plaintext, opened);
        }
    }

    [Fact]
    public void TamperAndTruncationFailClosed()
    {
        byte[] key = CryptoEngine.ParseKey(File.ReadAllText(DataPath("bench_key.hex")));
        using var crypto = new CryptoEngine(key);
        byte[] wire = crypto.Seal("hello"u8.ToArray());
        Assert.True(crypto.TryOpen(wire, out byte[] opened, out _));
        Assert.Equal("hello"u8.ToArray(), opened);

        wire[^1] ^= 0x01;
        Assert.False(crypto.TryOpen(wire, out _, out string error));
        Assert.Equal("decrypt_failed", error);
        Assert.False(crypto.TryOpen(new byte[10], out _, out string missingNonce));
        Assert.Equal("missing_nonce", missingNonce);
        Assert.False(crypto.TryOpen(new byte[20], out _, out string truncated));
        Assert.Equal("truncated_message", truncated);
    }

    private sealed class VectorFile
    {
        public List<VectorCase> Cases { get; set; } = [];
    }

    private sealed class VectorCase
    {
        public string Name { get; set; } = "";
        public string RequestJson { get; set; } = "";
        public string ResponseJson { get; set; } = "";
    }

    private sealed class KatFile
    {
        public string KeyHex { get; set; } = "";
        public List<KatCase> Cases { get; set; } = [];
    }

    private sealed class KatCase
    {
        public string NonceHex { get; set; } = "";
        public string PlaintextHex { get; set; } = "";
        public string CiphertextHex { get; set; } = "";
        public string TagHex { get; set; } = "";
    }
}
