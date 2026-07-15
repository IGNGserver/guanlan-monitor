using System.Net.Http.Json;
using System.Net;
using DeviceStateConsoleAgent.WinUI.Common;
using DeviceStateConsoleAgent.WinUI.Models;

namespace DeviceStateConsoleAgent.WinUI.Services;

public sealed class BackendApiClient
{
    private static readonly TimeSpan StateRequestTimeout = TimeSpan.FromSeconds(1.5);
    private readonly HttpClient _httpClient;

    public BackendApiClient()
    {
        _httpClient = new HttpClient(new HttpClientHandler
        {
            UseCookies = true,
            CookieContainer = new CookieContainer()
        })
        {
            BaseAddress = new Uri("http://127.0.0.1:17891/")
        };
    }

    public async Task<BackendStateDto?> GetStateAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(StateRequestTimeout);
            return await _httpClient.GetFromJsonAsync<BackendStateDto>("api/state", timeoutCts.Token);
        }
        catch
        {
            return null;
        }
    }

    public async Task SaveConfigAsync(AgentLocalConfig config, CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PutAsJsonAsync("api/config", config, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsync("api/control/start", null, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsync("api/control/stop", null, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task AttachFrontendAsync(int parentPid, CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsJsonAsync("api/control/attach-frontend", new { parentPid }, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task SetRealtimeModeAsync(bool enabled, int? durationSeconds = null, CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsJsonAsync("api/control/realtime", new { enabled, durationSeconds }, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task PushCloudAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsync("api/cloud/push", null, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<ConnectionCheckResultDto> CheckConnectionAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsync("api/control/check-connection", null, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var fallback = await response.Content.ReadFromJsonAsync<ConnectionCheckResultDto>(cancellationToken: cancellationToken);
            if (fallback is not null)
            {
                return fallback;
            }
        }

        await EnsureSuccessAsync(response, cancellationToken);
        return (await response.Content.ReadFromJsonAsync<ConnectionCheckResultDto>(cancellationToken: cancellationToken)) ?? new ConnectionCheckResultDto
        {
            Ok = false,
            Status = "empty_response",
            Message = "本地 backend 没有返回有效的连接检查结果。"
        };
    }

    public async Task<AgentRemoteStateDto?> GetRemoteStateAsync(
        string serverUrl,
        string secret,
        string deviceId,
        CancellationToken cancellationToken = default)
    {
        if (!ServerUrlPolicy.TryCreate(serverUrl, out var baseUri))
        {
            return null;
        }

        var uri = new Uri(baseUri, "/api/agent/device-state?deviceId=" + Uri.EscapeDataString(deviceId));

        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", secret);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(TimeSpan.FromSeconds(2));
        using var response = await _httpClient.SendAsync(request, timeoutCts.Token);
        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        return await response.Content.ReadFromJsonAsync<AgentRemoteStateDto>(timeoutCts.Token);
    }

    public async Task LoginViewerAsync(string serverUrl, string accessKey, CancellationToken cancellationToken = default)
    {
        var uri = BuildServerUri(serverUrl, "/api/auth/login");
        using var response = await _httpClient.PostAsJsonAsync(uri, new { accessKey }, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<IReadOnlyList<ViewerDeviceSummaryDto>> GetViewerDevicesAsync(
        string serverUrl,
        CancellationToken cancellationToken = default)
    {
        var uri = BuildServerUri(serverUrl, "/api/devices");
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<List<ViewerDeviceSummaryDto>>(cancellationToken: cancellationToken)
            ?? [];
    }

    public async Task<ViewerDeviceMetricsDto?> GetViewerDeviceMetricsAsync(
        string serverUrl,
        string deviceId,
        string window = "1m",
        CancellationToken cancellationToken = default)
    {
        var uri = BuildServerUri(serverUrl, "/api/devices/" + Uri.EscapeDataString(deviceId) + "/metrics?window=" + Uri.EscapeDataString(window));
        using var response = await _httpClient.GetAsync(uri, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<ViewerDeviceMetricsDto>(cancellationToken: cancellationToken);
    }

    public async Task<ProbeDetectResponseDto?> DetectAsync(CancellationToken cancellationToken = default)
    {
        using var response = await _httpClient.PostAsync("api/probes/detect", null, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<ProbeDetectResponseDto>(cancellationToken: cancellationToken);
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var error = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException(
            string.IsNullOrWhiteSpace(error)
                ? $"Backend request failed: {(int)response.StatusCode} {response.ReasonPhrase}"
                : error,
            null,
            response.StatusCode);
    }

    private static Uri BuildServerUri(string serverUrl, string path)
    {
        if (!ServerUrlPolicy.TryCreate(serverUrl, out var baseUri))
        {
            throw new HttpRequestException(ServerUrlPolicy.ValidationMessage(serverUrl));
        }

        return new Uri(baseUri, path);
    }
}
