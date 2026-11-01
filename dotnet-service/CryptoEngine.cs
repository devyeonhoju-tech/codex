using System.Security.Cryptography;

namespace CryptoBench;

/// <summary>
/// AES-256-GCM. One <see cref="AesGcm"/> per thread: the type is not thread-safe,
/// and constructing it per request would repeat the key schedule on the hot path.
/// Nonces come from <see cref="RandomNumberGenerator"/> (96-bit, fresh per seal).
/// </summary>
public sealed class CryptoEngine : IDisposable
{
    public const int KeyLength = 32;
    public const int NonceLength = 12;
    public const int TagLength = 16;

    private readonly ThreadLocal<AesGcm> _aes;
    private bool _disposed;

    public CryptoEngine(ReadOnlySpan<byte> key)
    {
        if (key.Length != KeyLength)
        {
            throw new ArgumentException("AES-256 key must be 32 bytes.", nameof(key));
        }

        byte[] keyCopy = key.ToArray();
        _aes = new ThreadLocal<AesGcm>(
            () => new AesGcm(keyCopy, TagLength),
            trackAllValues: true);
    }

    public static byte[] ParseKey(string hex)
    {
        string trimmed = hex.Trim();
        if (trimmed.Length != KeyLength * 2)
        {
            throw new FormatException("BENCH_AES_KEY must be 64 hex characters (32 bytes).");
        }

        return Convert.FromHexString(trimmed);
    }

    public byte[] Seal(ReadOnlySpan<byte> plaintext)
    {
        byte[] nonce = new byte[NonceLength];
        RandomNumberGenerator.Fill(nonce);
        return SealWithNonce(nonce, plaintext);
    }

    public byte[] SealWithNonce(ReadOnlySpan<byte> nonce, ReadOnlySpan<byte> plaintext)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (nonce.Length != NonceLength)
        {
            throw new ArgumentException("Nonce must be 12 bytes.", nameof(nonce));
        }

        byte[] ciphertext = new byte[plaintext.Length];
        byte[] tag = new byte[TagLength];
        Aes().Encrypt(nonce, plaintext, ciphertext, tag);

        byte[] wire = new byte[NonceLength + ciphertext.Length + TagLength];
        nonce.CopyTo(wire);
        ciphertext.CopyTo(wire.AsSpan(NonceLength));
        tag.CopyTo(wire.AsSpan(NonceLength + ciphertext.Length));
        return wire;
    }

    public bool TryOpen(ReadOnlySpan<byte> wire, out byte[] plaintext, out string error)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        plaintext = Array.Empty<byte>();
        if (wire.Length < NonceLength)
        {
            error = "missing_nonce";
            return false;
        }

        if (wire.Length < NonceLength + TagLength)
        {
            error = "truncated_message";
            return false;
        }

        ReadOnlySpan<byte> nonce = wire[..NonceLength];
        ReadOnlySpan<byte> tag = wire[^TagLength..];
        ReadOnlySpan<byte> ciphertext = wire[NonceLength..^TagLength];
        byte[] buffer = new byte[ciphertext.Length];
        try
        {
            Aes().Decrypt(nonce, ciphertext, tag, buffer);
        }
        catch (CryptographicException)
        {
            error = "decrypt_failed";
            return false;
        }

        plaintext = buffer;
        error = "";
        return true;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        foreach (AesGcm aes in _aes.Values)
        {
            aes.Dispose();
        }

        _aes.Dispose();
    }

    private AesGcm Aes()
    {
        return _aes.Value ?? throw new ObjectDisposedException(nameof(CryptoEngine));
    }
}
