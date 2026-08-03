using System.Diagnostics;
using System.Net.Http.Json;
using System.Security.Cryptography;
using DeviceStateConsoleAgent.WinUI.Models;

namespace DeviceStateConsoleAgent.WinUI.Services;

public sealed class UpdateService
{
    private readonly HttpClient _httpClient = new()
    {
        Timeout = TimeSpan.FromSeconds(20)
    };

    public async Task<UpdateInfoDto?> CheckAsync(
        string serverUrl,
        string currentVersion,
        string currentChannel,
        CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(serverUrl.TrimEnd('/') + "/api/updates", UriKind.Absolute, out var baseUri))
        {
            return null;
        }

        var builder = new UriBuilder(baseUri);
        builder.Query = string.Join("&", new[]
        {
            $"platform={Uri.EscapeDataString("windows-gui")}",
            $"currentVersion={Uri.EscapeDataString(currentVersion)}",
            $"currentChannel={Uri.EscapeDataString(currentChannel)}",
            "arch=amd64"
        });

        try
        {
            return await _httpClient.GetFromJsonAsync<UpdateInfoDto>(builder.Uri, cancellationToken);
        }
        catch
        {
            return null;
        }
    }

    public async Task<string> DownloadInstallerAsync(
        UpdateInfoDto update,
        IProgress<double>? progress = null,
        CancellationToken cancellationToken = default)
    {
        if (!Uri.TryCreate(update.AssetUrl, UriKind.Absolute, out var assetUri))
        {
            throw new InvalidOperationException("更新安装包地址无效。");
        }

        var fileName = Path.GetFileName(assetUri.AbsolutePath);
        if (string.IsNullOrWhiteSpace(fileName) || !fileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("更新资产不是 Windows 安装程序。");
        }

        var destination = Path.Combine(Path.GetTempPath(), $"dsc-update-{Guid.NewGuid():N}-{fileName}");
        using var response = await _httpClient.GetAsync(assetUri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        response.EnsureSuccessStatusCode();
        await using var input = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var output = File.Create(destination);
        var total = response.Content.Headers.ContentLength;
        var buffer = new byte[128 * 1024];
        long copied = 0;
        int read;
        while ((read = await input.ReadAsync(buffer, cancellationToken)) > 0)
        {
            await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
            copied += read;
            if (total is > 0) progress?.Report((double)copied / total.Value);
        }
        await output.FlushAsync(cancellationToken);

        if (string.IsNullOrWhiteSpace(update.Sha256))
        {
            File.Delete(destination);
            throw new InvalidOperationException("更新包没有 SHA-256 校验值，已阻止启动。");
        }
        await using var verifyStream = File.OpenRead(destination);
        var digest = Convert.ToHexString(await SHA256.HashDataAsync(verifyStream, cancellationToken));
        if (!string.Equals(digest, update.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(destination);
            throw new InvalidOperationException("更新安装包校验失败，已阻止启动。");
        }

        return destination;
    }

    public static void LaunchInstaller(string path)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = path,
            UseShellExecute = true,
            Verb = "runas"
        });
    }
}
