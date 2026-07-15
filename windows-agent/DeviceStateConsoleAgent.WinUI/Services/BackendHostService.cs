using System.Diagnostics;
using System.Net.Http;

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

        if (IsBackendReachable())
        {
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
            Arguments = $"--bundle-root \"{ResolveBackendBundleRoot()}\" --config-root \"{ResolveConfigRoot()}\" --parent-pid {Environment.ProcessId}",
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

    private static bool IsBackendReachable()
    {
        try
        {
            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromMilliseconds(800)
            };
            using var response = httpClient.GetAsync(BackendStateUri).GetAwaiter().GetResult();
            return response.IsSuccessStatusCode;
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
