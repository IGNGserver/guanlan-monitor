using System.Diagnostics;
using System.Net.Http;
using System.Net.Http.Json;
using DeviceStateConsoleAgent.WinUI.Models;

namespace DeviceStateConsoleAgent.WinUI.Services;

public sealed class BackendHostService
{
    private static readonly Uri BackendShutdownUri = new("http://127.0.0.1:17891/api/control/shutdown");
    private static readonly Uri BackendStateUri = new("http://127.0.0.1:17891/api/state");
    private string? _resolvedConfigRoot;
    private bool? _resolvedPortableMode;
    private Process? _process;
    private bool _attachedToExistingBackend;

    public bool IsManagedProcessRunning => _process is { HasExited: false };
    public bool IsAttachedToExistingBackend => _attachedToExistingBackend && !IsManagedProcessRunning;

    public string ResolveBackendExe()
    {
        return Path.Combine(AppContext.BaseDirectory, "backend", "windows-agent-backend.exe");
    }

    public string ResolveBackendBundleRoot()
    {
        return Path.Combine(AppContext.BaseDirectory, "backend");
    }

    public string ResolveConfigRoot()
    {
        if (!string.IsNullOrWhiteSpace(_resolvedConfigRoot))
        {
            return _resolvedConfigRoot;
        }

        if (IsInstalledMode())
        {
            var local = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeviceStateConsoleAgent");
            Directory.CreateDirectory(local);
            _resolvedPortableMode = false;
            _resolvedConfigRoot = local;
            return _resolvedConfigRoot;
        }

        var portableCandidate = AppContext.BaseDirectory;
        try
        {
            Directory.CreateDirectory(portableCandidate);
            var probePath = Path.Combine(portableCandidate, ".portable-write-test");
            File.WriteAllText(probePath, "ok");
            File.Delete(probePath);
            _resolvedPortableMode = true;
            _resolvedConfigRoot = portableCandidate;
            return _resolvedConfigRoot;
        }
        catch
        {
            var local = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeviceStateConsoleAgent");
            Directory.CreateDirectory(local);
            _resolvedPortableMode = false;
            _resolvedConfigRoot = local;
            return _resolvedConfigRoot;
        }
    }

    public bool IsPortableMode()
    {
        if (_resolvedPortableMode.HasValue)
        {
            return _resolvedPortableMode.Value;
        }

        _ = ResolveConfigRoot();
        return _resolvedPortableMode ?? false;
    }

    public void EnsureStarted()
    {
        if (_process is { HasExited: false })
        {
            return;
        }

        var expectedConfigRoot = ResolveConfigRoot();
        var existingConfigPath = GetReachableBackendConfigPath();
        if (existingConfigPath is not null)
        {
            if (!PathsShareRoot(existingConfigPath, expectedConfigRoot))
            {
                throw new InvalidOperationException(
                    $"检测到 17891 端口已有其他配置目录的 backend：{Path.GetDirectoryName(existingConfigPath)}。请先关闭它后再启动当前客户端。");
            }

            _attachedToExistingBackend = true;
            return;
        }

        var backendExe = ResolveBackendExe();
        if (!File.Exists(backendExe))
        {
            throw new FileNotFoundException("Local backend executable was not found.", backendExe);
        }

        _attachedToExistingBackend = false;
        _process = Process.Start(new ProcessStartInfo
        {
            FileName = backendExe,
            Arguments = $"--bundle-root \"{ResolveBackendBundleRoot()}\" --config-root \"{expectedConfigRoot}\" --parent-pid {Environment.ProcessId}",
            WorkingDirectory = Path.GetDirectoryName(backendExe) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }

    public void Restart()
    {
        if (IsAttachedToExistingBackend)
        {
            _attachedToExistingBackend = false;
        }

        Stop();
        EnsureStarted();
    }

    public void Stop()
    {
        try
        {
            if (_attachedToExistingBackend && _process is null)
            {
                return;
            }

            if (_process is { HasExited: false })
            {
                using var httpClient = new HttpClient
                {
                    Timeout = TimeSpan.FromSeconds(2)
                };

                try
                {
                    using var response = httpClient.PostAsync(BackendShutdownUri, null).GetAwaiter().GetResult();
                    if (response.IsSuccessStatusCode)
                    {
                        _process.WaitForExit(3000);
                    }
                }
                catch
                {
                }

                if (!_process.HasExited)
                {
                    _process.Kill(entireProcessTree: true);
                    _process.WaitForExit(2000);
                }
            }
        }
        catch
        {
        }
        finally
        {
            _process?.Dispose();
            _process = null;
            _attachedToExistingBackend = false;
        }
    }

    private static string? GetReachableBackendConfigPath()
    {
        try
        {
            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromMilliseconds(800)
            };
            using var response = httpClient.GetAsync(BackendStateUri).GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var state = response.Content.ReadFromJsonAsync<BackendStateDto>().GetAwaiter().GetResult();
            return string.IsNullOrWhiteSpace(state?.ConfigPath) ? string.Empty : state.ConfigPath;
        }
        catch
        {
            return null;
        }
    }

    private static bool PathsShareRoot(string configPath, string configRoot)
    {
        try
        {
            var actualRoot = Path.GetFullPath(Path.GetDirectoryName(configPath) ?? string.Empty)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            var expectedRoot = Path.GetFullPath(configRoot)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            return string.Equals(actualRoot, expectedRoot, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static bool IsInstalledMode()
    {
        var installRoot = AppContext.BaseDirectory;
        return File.Exists(Path.Combine(installRoot, "unins001.exe")) ||
               File.Exists(Path.Combine(installRoot, "unins000.exe"));
    }
}
