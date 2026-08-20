using System.Collections;
using System.Globalization;
using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using System.Text.Json.Serialization;

internal static class Program
{
    private static int Main(string[] args)
    {
        var dllPath = ReadArgument(args, "--dll");
        if (string.IsNullOrWhiteSpace(dllPath) || !File.Exists(dllPath))
        {
            Console.Error.WriteLine("LibreHardwareMonitorLib.dll was not found.");
            return 2;
        }

        try
        {
            var result = ReadSnapshots(Path.GetFullPath(dllPath));
            Console.WriteLine(JsonSerializer.Serialize(result));
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception.GetBaseException().Message);
            return 1;
        }
    }

    private static HardwareProbeResult ReadSnapshots(string dllPath)
    {
        var dllDirectory = Path.GetDirectoryName(dllPath) ?? AppContext.BaseDirectory;
        var loadContext = AssemblyLoadContext.Default;
        loadContext.Resolving += (_, assemblyName) =>
        {
            var dependencyPath = Path.Combine(dllDirectory, $"{assemblyName.Name}.dll");
            return File.Exists(dependencyPath)
                ? loadContext.LoadFromAssemblyPath(dependencyPath)
                : null;
        };

        var assembly = loadContext.LoadFromAssemblyPath(dllPath);
        var computerType = assembly.GetType("LibreHardwareMonitor.Hardware.Computer")
            ?? throw new InvalidOperationException("LibreHardwareMonitor Computer type was not found.");
        var computer = Activator.CreateInstance(computerType)
            ?? throw new InvalidOperationException("LibreHardwareMonitor Computer could not be created.");
        var pawnIo = ReadPawnIoStatus(assembly);

        SetProperty(computer, "IsCpuEnabled", true);
        SetProperty(computer, "IsGpuEnabled", true);
        SetProperty(computer, "IsMotherboardEnabled", true);
        SetProperty(computer, "IsControllerEnabled", true);
        SetProperty(computer, "IsStorageEnabled", true);
        SetProperty(computer, "IsNetworkEnabled", true);

        Invoke(computer, "Open");
        try
        {
            // A freshly opened LHM instance may need more than one update
            // cycle before CPU package and GPU temperature sensors publish a
            // value. Warm the tree briefly, then take the actual snapshot.
            for (var pass = 0; pass < 2; pass++)
            {
                foreach (var hardware in Enumerate(GetPropertyValue(computer, "Hardware")))
                {
                    UpdateHardwareTree(hardware);
                }
                Thread.Sleep(250);
            }
            var snapshots = new List<HardwareSnapshot>();
            foreach (var hardware in Enumerate(GetPropertyValue(computer, "Hardware")))
            {
                ReadHardware(hardware, snapshots);
            }
            return new HardwareProbeResult
            {
                Snapshots = snapshots,
                PawnIo = pawnIo
            };
        }
        finally
        {
            Invoke(computer, "Close");
        }
    }

    private static void UpdateHardwareTree(object hardware)
    {
        Invoke(hardware, "Update");
        foreach (var child in Enumerate(GetPropertyValue(hardware, "SubHardware")))
        {
            UpdateHardwareTree(child);
        }
    }

    private static void ReadHardware(object hardware, ICollection<HardwareSnapshot> snapshots)
    {
        Invoke(hardware, "Update");

        var snapshot = new HardwareSnapshot
        {
            HardwareType = ToText(GetPropertyValue(hardware, "HardwareType")),
            Name = ToText(GetPropertyValue(hardware, "Name")),
            InstanceId = ToText(GetPropertyValue(hardware, "Identifier")),
            Sensors = Enumerate(GetPropertyValue(hardware, "Sensors"))
                .Select(ReadSensor)
                .ToList()
        };

        var storage = GetPropertyValue(hardware, "Storage") ?? hardware;
        var smart = GetPropertyValue(storage, "Smart");
        snapshot.TemperatureC = ToNullableDouble(GetPropertyValue(smart, "Temperature"));
        snapshot.HealthPercent = ToNullableDouble(GetPropertyValue(smart, "Life"));
        snapshot.HealthStatus = ToText(GetPropertyValue(smart, "DiskStatus"));
        if (!string.IsNullOrWhiteSpace(snapshot.HealthStatus) && !string.Equals(snapshot.HealthStatus, "Unknown", StringComparison.OrdinalIgnoreCase))
        {
            snapshot.HealthReason = "SMART status from LibreHardwareMonitor";
        }

        var attributes = GetPropertyValue(hardware, "Attributes") ?? GetPropertyValue(storage, "Attributes");
        snapshot.SmartAttributes = Enumerate(attributes)
            .Select(attribute => new HardwareSmartAttribute
            {
                Id = (int)(ToNullableDouble(GetPropertyValue(attribute, "Id")) ?? 0),
                Name = ToText(GetPropertyValue(attribute, "Name")),
                Value = ToNullableDouble(GetPropertyValue(attribute, "Value")) ?? 0,
                Threshold = ToNullableDouble(GetPropertyValue(attribute, "Threshold")) ?? 0
            })
            .ToList();

        snapshots.Add(snapshot);
        foreach (var child in Enumerate(GetPropertyValue(hardware, "SubHardware")))
        {
            ReadHardware(child, snapshots);
        }
    }

    private static HardwareSensor ReadSensor(object sensor)
    {
        return new HardwareSensor
        {
            SensorType = ToText(GetPropertyValue(sensor, "SensorType")),
            Name = ToText(GetPropertyValue(sensor, "Name")),
            Value = ToNullableDouble(GetPropertyValue(sensor, "Value"))
        };
    }

    private static PawnIoStatus ReadPawnIoStatus(Assembly assembly)
    {
        try
        {
            var pawnIoType = assembly.GetType("LibreHardwareMonitor.PawnIo.PawnIo");
            if (pawnIoType is null)
            {
                return new PawnIoStatus
                {
                    Available = false,
                    Error = "LibreHardwareMonitor PawnIO API was not found."
                };
            }

            var installed = pawnIoType.GetProperty("IsInstalled", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            var loaded = pawnIoType.GetProperty("IsLoaded", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            var version = pawnIoType.GetProperty("Version", BindingFlags.Public | BindingFlags.Static)?.GetValue(null);
            return new PawnIoStatus
            {
                Available = true,
                Installed = ToNullableBool(installed),
                Loaded = ToNullableBool(loaded),
                Version = ToText(version)
            };
        }
        catch (Exception exception)
        {
            return new PawnIoStatus
            {
                Available = true,
                Error = exception.GetBaseException().Message
            };
        }
    }

    private static string? ReadArgument(IReadOnlyList<string> args, string name)
    {
        for (var index = 0; index < args.Count - 1; index++)
        {
            if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase))
            {
                return args[index + 1];
            }
        }

        return null;
    }

    private static void SetProperty(object target, string name, object value)
    {
        var property = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
        if (property?.CanWrite == true && property.PropertyType.IsInstanceOfType(value))
        {
            property.SetValue(target, value);
        }
    }

    private static object? GetPropertyValue(object? target, string name)
    {
        if (target is null) return null;
        var property = target.GetType().GetProperty(name, BindingFlags.Public | BindingFlags.Instance);
        return property?.GetValue(target);
    }

    private static void Invoke(object target, string name)
    {
        target.GetType().GetMethod(name, BindingFlags.Public | BindingFlags.Instance)?.Invoke(target, null);
    }

    private static IEnumerable<object> Enumerate(object? value)
    {
        if (value is not IEnumerable enumerable) yield break;
        foreach (var item in enumerable)
        {
            if (item is not null) yield return item;
        }
    }

    private static string ToText(object? value) => value?.ToString()?.Trim() ?? string.Empty;

    private static double? ToNullableDouble(object? value)
    {
        if (value is null) return null;
        try
        {
            var number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
            return double.IsFinite(number) ? number : null;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private static bool? ToNullableBool(object? value)
    {
        if (value is null) return null;
        try
        {
            return Convert.ToBoolean(value, CultureInfo.InvariantCulture);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private sealed class HardwareProbeResult
    {
        [JsonPropertyName("snapshots")]
        public List<HardwareSnapshot> Snapshots { get; set; } = [];

        [JsonPropertyName("pawnIo")]
        public PawnIoStatus PawnIo { get; set; } = new();
    }

    private sealed class PawnIoStatus
    {
        [JsonPropertyName("available")]
        public bool Available { get; set; }

        [JsonPropertyName("installed")]
        public bool? Installed { get; set; }

        [JsonPropertyName("loaded")]
        public bool? Loaded { get; set; }

        [JsonPropertyName("version")]
        public string Version { get; set; } = string.Empty;

        [JsonPropertyName("error")]
        public string Error { get; set; } = string.Empty;
    }

    private sealed class HardwareSnapshot
    {
        [JsonPropertyName("hardwareType")]
        public string HardwareType { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("instanceId")]
        public string InstanceId { get; set; } = string.Empty;

        [JsonPropertyName("temperatureC")]
        public double? TemperatureC { get; set; }

        [JsonPropertyName("healthPercent")]
        public double? HealthPercent { get; set; }

        [JsonPropertyName("healthStatus")]
        public string HealthStatus { get; set; } = string.Empty;

        [JsonPropertyName("healthReason")]
        public string HealthReason { get; set; } = string.Empty;

        [JsonPropertyName("smartAttributes")]
        public List<HardwareSmartAttribute> SmartAttributes { get; set; } = [];

        [JsonPropertyName("sensors")]
        public List<HardwareSensor> Sensors { get; set; } = [];
    }

    private sealed class HardwareSensor
    {
        [JsonPropertyName("sensorType")]
        public string SensorType { get; set; } = string.Empty;

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("value")]
        public double? Value { get; set; }
    }

    private sealed class HardwareSmartAttribute
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; } = string.Empty;

        [JsonPropertyName("value")]
        public double Value { get; set; }

        [JsonPropertyName("threshold")]
        public double Threshold { get; set; }
    }
}
