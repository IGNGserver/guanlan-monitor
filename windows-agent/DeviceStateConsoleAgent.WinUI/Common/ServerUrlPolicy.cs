using System.Net;

namespace DeviceStateConsoleAgent.WinUI.Common;

public static class ServerUrlPolicy
{
    public static bool IsAllowed(string? value) => TryCreate(value, out _);

    public static bool TryCreate(string? value, out Uri uri)
    {
        uri = null!;
        if (!Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var parsed) ||
            string.IsNullOrWhiteSpace(parsed.Host) ||
            !string.IsNullOrWhiteSpace(parsed.UserInfo))
        {
            return false;
        }

        if (string.Equals(parsed.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) ||
            (string.Equals(parsed.Scheme, Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase) && IsTrustedPrivateHttpHost(parsed.Host)))
        {
            uri = parsed;
            return true;
        }

        return false;
    }

    public static string ValidationMessage(string? value) =>
        TryCreate(value, out _)
            ? string.Empty
            : "公网中枢必须使用 HTTPS；HTTP 仅允许 localhost 或可信私网地址（10.x、172.16-31.x、192.168.x）。";

    private static bool IsTrustedPrivateHttpHost(string host)
    {
        if (string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        if (!IPAddress.TryParse(host, out var address))
        {
            return false;
        }

        if (IPAddress.IsLoopback(address))
        {
            return true;
        }

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return bytes[0] == 10 ||
                   (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
                   (bytes[0] == 192 && bytes[1] == 168);
        }

        return address.IsIPv6LinkLocal || address.IsIPv6SiteLocal;
    }
}
