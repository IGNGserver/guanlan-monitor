using System.Runtime.InteropServices;

namespace DeviceStateConsoleAgent.WinUI.Services;

public static class ViewerCredentialStore
{
    private static readonly string CredentialPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "DeviceStateConsoleAgent",
        "viewer-access-key.bin");

    public static string Load()
    {
        try
        {
            if (!File.Exists(CredentialPath))
            {
                return string.Empty;
            }

            var protectedBytes = File.ReadAllBytes(CredentialPath);
            var plainBytes = Unprotect(protectedBytes);
            return System.Text.Encoding.UTF8.GetString(plainBytes);
        }
        catch
        {
            return string.Empty;
        }
    }

    public static void Save(string value)
    {
        try
        {
            var directory = Path.GetDirectoryName(CredentialPath);
            if (!string.IsNullOrWhiteSpace(directory))
            {
                Directory.CreateDirectory(directory);
            }

            if (string.IsNullOrEmpty(value))
            {
                File.Delete(CredentialPath);
                return;
            }

            File.WriteAllBytes(CredentialPath, Protect(System.Text.Encoding.UTF8.GetBytes(value)));
        }
        catch
        {
            // A missing credential should never prevent the agent UI from starting.
        }
    }

    private static byte[] Protect(byte[] value) => Transform(value, CryptProtectData);

    private static byte[] Unprotect(byte[] value) => Transform(value, CryptUnprotectData);

    private static byte[] Transform(byte[] value, CryptTransform transform)
    {
        var input = new DataBlob(value);
        try
        {
            if (!transform(ref input.Blob, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out var output))
            {
                throw new InvalidOperationException("Windows credential protection failed.");
            }

            try
            {
                var result = new byte[output.cbData];
                Marshal.Copy(output.pbData, result, 0, result.Length);
                return result;
            }
            finally
            {
                if (output.pbData != IntPtr.Zero)
                {
                    LocalFree(output.pbData);
                }
            }
        }
        finally
        {
            input.Dispose();
        }
    }

    private delegate bool CryptTransform(
        ref DATA_BLOB dataIn,
        string? description,
        IntPtr entropy,
        IntPtr reserved,
        IntPtr prompt,
        int flags,
        out DATA_BLOB dataOut);

    [StructLayout(LayoutKind.Sequential)]
    private struct DATA_BLOB
    {
        public int cbData;
        public IntPtr pbData;
    }

    private sealed class DataBlob : IDisposable
    {
        public DataBlob(byte[] value)
        {
            Blob = new DATA_BLOB
            {
                cbData = value.Length,
                pbData = Marshal.AllocHGlobal(value.Length)
            };
            Marshal.Copy(value, 0, Blob.pbData, value.Length);
        }

        public DATA_BLOB Blob;

        public void Dispose()
        {
            if (Blob.pbData != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(Blob.pbData);
                Blob.pbData = IntPtr.Zero;
            }
        }
    }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DATA_BLOB dataIn,
        string? description,
        IntPtr entropy,
        IntPtr reserved,
        IntPtr prompt,
        int flags,
        out DATA_BLOB dataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DATA_BLOB dataIn,
        string? description,
        IntPtr entropy,
        IntPtr reserved,
        IntPtr prompt,
        int flags,
        out DATA_BLOB dataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr memory);
}
