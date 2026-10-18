//go:build darwin && cgo

// Read-only Darwin inventory and sensor bridge. Every reader returns raw
// observations as JSON; scaling, role mapping and availability decisions live
// in Go (extras.go) where they are unit tested. Private symbols are resolved
// with dlsym, so a missing API is a capability failure, never a link failure.
#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#import <IOKit/IOCFPlugIn.h>
#import <IOKit/ps/IOPowerSources.h>
#import <IOKit/ps/IOPSKeys.h>
#import <IOKit/storage/nvme/NVMeSMARTLibExternal.h>
#import <IOKit/storage/ata/ATASMARTLib.h>
#import <CoreWLAN/CoreWLAN.h>
#import <SystemConfiguration/SystemConfiguration.h>
#include <sys/sysctl.h>
#include <libproc.h>
#include <notify.h>
#include <dlfcn.h>
#include <math.h>

static char *extraJSON(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    if (!data) return NULL;
    char *copy = malloc(data.length + 1);
    if (!copy) return NULL;
    memcpy(copy, data.bytes, data.length); copy[data.length] = 0; return copy;
}

static NSString *stringProperty(id value) {
    if (![value isKindOfClass:[NSString class]]) return nil;
    NSString *trimmed = [(NSString *)value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    return trimmed.length ? trimmed : nil;
}

static NSNumber *numberProperty(id value) {
    if (![value isKindOfClass:[NSNumber class]]) return nil;
    double n = [value doubleValue];
    return isfinite(n) ? value : nil;
}

// ---------------------------------------------------------------- storage

static io_registry_entry_t parentWithProperty(io_registry_entry_t entry, CFStringRef key) {
    io_registry_entry_t current = entry; IOObjectRetain(current);
    for (int depth = 0; depth < 16 && current; depth++) {
        CFTypeRef value = IORegistryEntryCreateCFProperty(current, key, kCFAllocatorDefault, 0);
        if (value) {
            BOOL capable = CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue((CFBooleanRef)value);
            CFRelease(value);
            if (capable) return current;
        }
        io_registry_entry_t parent = 0;
        kern_return_t status = IORegistryEntryGetParentEntry(current, kIOServicePlane, &parent);
        IOObjectRelease(current);
        current = status == KERN_SUCCESS ? parent : 0;
    }
    if (current) IOObjectRelease(current);
    return 0;
}

static NSString *hexBytes(const uint8_t *bytes, size_t length) {
    NSMutableString *text = [NSMutableString stringWithCapacity:length * 2];
    for (size_t i = 0; i < length; i++) [text appendFormat:@"%02x", bytes[i]];
    return text;
}

static NSDictionary *readNVMeSMART(io_registry_entry_t service) {
    IOCFPlugInInterface **plugin = NULL; SInt32 score = 0;
    if (IOCreatePlugInInterfaceForService(service, kIONVMeSMARTUserClientTypeID, kIOCFPlugInInterfaceID, &plugin, &score) != kIOReturnSuccess || !plugin) {
        return @{@"Error": @"NVMe SMART user client unavailable"};
    }
    IONVMeSMARTInterface **smart = NULL;
    HRESULT result = (*plugin)->QueryInterface(plugin, CFUUIDGetUUIDBytes(kIONVMeSMARTInterfaceID), (LPVOID *)&smart);
    NSDictionary *report = @{@"Error": @"NVMe SMART interface unavailable"};
    if (result == S_OK && smart) {
        NVMeSMARTData data; memset(&data, 0, sizeof(data));
        if ((*smart)->SMARTReadData(smart, &data) == kIOReturnSuccess) {
            // The raw 512-byte log page is decoded in Go, so byte order and
            // 128-bit counters are handled in one tested place.
            report = @{@"Log": hexBytes((const uint8_t *)&data, sizeof(data))};
        } else {
            report = @{@"Error": @"NVMe SMART read failed"};
        }
        (*smart)->Release(smart);
    }
    IODestroyPlugInInterface(plugin);
    return report;
}

static NSDictionary *readATASMART(io_registry_entry_t service) {
    IOCFPlugInInterface **plugin = NULL; SInt32 score = 0;
    if (IOCreatePlugInInterfaceForService(service, kIOATASMARTUserClientTypeID, kIOCFPlugInInterfaceID, &plugin, &score) != kIOReturnSuccess || !plugin) {
        return @{@"Error": @"ATA SMART user client unavailable"};
    }
    IOATASMARTInterface **smart = NULL;
    HRESULT result = (*plugin)->QueryInterface(plugin, CFUUIDGetUUIDBytes(kIOATASMARTInterfaceID), (LPVOID *)&smart);
    NSMutableDictionary *report = [@{@"Error": @"ATA SMART interface unavailable"} mutableCopy];
    if (result == S_OK && smart) {
        [report removeAllObjects];
        Boolean exceeded = false;
        if ((*smart)->SMARTReturnStatus(smart, &exceeded) == kIOReturnSuccess) report[@"ThresholdExceeded"] = exceeded ? @YES : @NO;
        ATASMARTData data; memset(&data, 0, sizeof(data));
        if ((*smart)->SMARTReadData(smart, &data) == kIOReturnSuccess) report[@"Data"] = hexBytes((const uint8_t *)&data, sizeof(data));
        ATASMARTDataThresholds thresholds; memset(&thresholds, 0, sizeof(thresholds));
        if ((*smart)->SMARTReadDataThresholds(smart, &thresholds) == kIOReturnSuccess) report[@"Thresholds"] = hexBytes((const uint8_t *)&thresholds, sizeof(thresholds));
        if (!report.count) report[@"Error"] = @"ATA SMART read failed";
        (*smart)->Release(smart);
    }
    IODestroyPlugInInterface(plugin);
    return report;
}

char *guanlan_storage(int includeSMART) {
    @autoreleasepool {
        NSMutableArray *disks = [NSMutableArray array];
        CFMutableDictionaryRef matching = IOServiceMatching("IOMedia");
        if (!matching) return extraJSON(disks);
        CFDictionarySetValue(matching, CFSTR("Whole"), kCFBooleanTrue);
        io_iterator_t iterator = 0;
        if (IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator) != KERN_SUCCESS) return extraJSON(disks);
        io_registry_entry_t media;
        while ((media = IOIteratorNext(iterator))) {
            CFTypeRef bsd = IORegistryEntryCreateCFProperty(media, CFSTR("BSD Name"), kCFAllocatorDefault, 0);
            NSString *name = stringProperty((__bridge id)bsd);
            if (bsd) CFRelease(bsd);
            if (!name) { IOObjectRelease(media); continue; }
            NSMutableDictionary *disk = [@{@"BSDName": name} mutableCopy];
            IOOptionBits up = kIORegistryIterateRecursively | kIORegistryIterateParents;
            CFTypeRef device = IORegistryEntrySearchCFProperty(media, kIOServicePlane, CFSTR("Device Characteristics"), kCFAllocatorDefault, up);
            if (device && CFGetTypeID(device) == CFDictionaryGetTypeID()) {
                NSDictionary *d = (__bridge NSDictionary *)device;
                NSString *product = stringProperty(d[@"Product Name"]); if (product) disk[@"Product"] = product;
                NSString *vendor = stringProperty(d[@"Vendor Name"]); if (vendor) disk[@"Vendor"] = vendor;
                NSString *medium = stringProperty(d[@"Medium Type"]); if (medium) disk[@"Medium"] = medium;
            }
            if (device) CFRelease(device);
            CFTypeRef protocol = IORegistryEntrySearchCFProperty(media, kIOServicePlane, CFSTR("Protocol Characteristics"), kCFAllocatorDefault, up);
            if (protocol && CFGetTypeID(protocol) == CFDictionaryGetTypeID()) {
                NSDictionary *p = (__bridge NSDictionary *)protocol;
                NSString *interconnect = stringProperty(p[@"Physical Interconnect"]); if (interconnect) disk[@"Interconnect"] = interconnect;
                NSString *location = stringProperty(p[@"Physical Interconnect Location"]); if (location) disk[@"Location"] = location;
            }
            if (protocol) CFRelease(protocol);
            // SMART is read on its own (longer) cadence: an ATA query can spin
            // up a sleeping drive, and inventory alone never needs it.
            io_registry_entry_t nvme = parentWithProperty(media, CFSTR("NVMe SMART Capable"));
            if (nvme) {
                disk[@"NVMe"] = includeSMART ? readNVMeSMART(nvme) : @{@"Error": @"not sampled"};
                IOObjectRelease(nvme);
            } else if (includeSMART) {
                io_registry_entry_t ata = parentWithProperty(media, CFSTR("SMART Capable"));
                if (ata) { disk[@"ATA"] = readATASMART(ata); IOObjectRelease(ata); }
            }
            [disks addObject:disk];
            IOObjectRelease(media);
        }
        IOObjectRelease(iterator);
        return extraJSON(disks);
    }
}

// ---------------------------------------------------------------- network

char *guanlan_network(void) {
    @autoreleasepool {
        NSMutableDictionary *report = [NSMutableDictionary dictionary];
        NSMutableArray *interfaces = [NSMutableArray array];
        io_iterator_t iterator = 0;
        if (IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IONetworkInterface"), &iterator) == KERN_SUCCESS) {
            io_registry_entry_t service;
            while ((service = IOIteratorNext(iterator))) {
                CFTypeRef bsd = IORegistryEntryCreateCFProperty(service, CFSTR("BSD Name"), kCFAllocatorDefault, 0);
                NSString *name = stringProperty((__bridge id)bsd);
                if (bsd) CFRelease(bsd);
                io_registry_entry_t controller = 0;
                if (name && IORegistryEntryGetParentEntry(service, kIOServicePlane, &controller) == KERN_SUCCESS) {
                    NSMutableDictionary *item = [@{@"BSDName": name} mutableCopy];
                    CFMutableDictionaryRef properties = NULL;
                    if (IORegistryEntryCreateCFProperties(controller, &properties, kCFAllocatorDefault, 0) == KERN_SUCCESS && properties) {
                        NSDictionary *p = (__bridge NSDictionary *)properties;
                        NSNumber *speed = numberProperty(p[@"IOLinkSpeed"]); if (speed) item[@"LinkSpeed"] = speed;
                        NSNumber *status = numberProperty(p[@"IOLinkStatus"]); if (status) item[@"LinkStatus"] = status;
                        NSString *model = stringProperty(p[@"IOModel"]); if (model) item[@"Model"] = model;
                        NSString *vendor = stringProperty(p[@"IOVendor"]); if (vendor) item[@"Vendor"] = vendor;
                        NSString *klass = stringProperty(p[@"IOClass"]); if (klass) item[@"Class"] = klass;
                        CFRelease(properties);
                    }
                    // BOOL is signed char on x86_64; boxing it yields 0/1, not JSON booleans.
                    BOOL wireless = IOObjectConformsTo(service, "IO80211Interface") || IOObjectConformsTo(controller, "IO80211Controller") || IOObjectConformsTo(service, "IO80211VirtualInterface");
                    item[@"Wireless"] = wireless ? @YES : @NO;
                    [interfaces addObject:item];
                    IOObjectRelease(controller);
                }
                IOObjectRelease(service);
            }
            IOObjectRelease(iterator);
        }
        // SystemConfiguration names the interface the way System Settings does
        // (Wi-Fi, Ethernet, Thunderbolt Bridge, iPhone USB...).
        NSMutableDictionary *types = [NSMutableDictionary dictionary];
        CFArrayRef all = SCNetworkInterfaceCopyAll();
        if (all) {
            for (CFIndex i = 0; i < CFArrayGetCount(all); i++) {
                SCNetworkInterfaceRef interface = (SCNetworkInterfaceRef)CFArrayGetValueAtIndex(all, i);
                NSString *bsd = (__bridge NSString *)SCNetworkInterfaceGetBSDName(interface);
                NSString *type = (__bridge NSString *)SCNetworkInterfaceGetInterfaceType(interface);
                if (bsd && type) types[bsd] = type;
            }
            CFRelease(all);
        }
        report[@"Interfaces"] = interfaces;
        report[@"Types"] = types;
        // CoreWLAN signal metrics are not location-gated; SSID/BSSID are and
        // are deliberately never read.
        NSMutableArray *wifi = [NSMutableArray array];
        @try {
            for (CWInterface *interface in [[CWWiFiClient sharedWiFiClient] interfaces]) {
                if (!interface.interfaceName) continue;
                NSMutableDictionary *item = [@{@"BSDName": interface.interfaceName, @"PowerOn": interface.powerOn ? @YES : @NO} mutableCopy];
                NSInteger rssi = interface.rssiValue, noise = interface.noiseMeasurement;
                if (rssi < 0) item[@"RSSI"] = @(rssi);
                if (noise < 0) item[@"Noise"] = @(noise);
                double rate = interface.transmitRate;
                if (isfinite(rate) && rate > 0) item[@"TxRate"] = @(rate);
                [wifi addObject:item];
            }
        } @catch (NSException *exception) {
            report[@"WiFiError"] = exception.reason ?: @"CoreWLAN unavailable";
        }
        report[@"WiFi"] = wifi;
        return extraJSON(report);
    }
}

// ---------------------------------------------------------------- system

static NSNumber *sysctlInteger(const char *name) {
    int64_t value = 0; size_t size = sizeof(value);
    if (sysctlbyname(name, &value, &size, NULL, 0) != 0) return nil;
    if (size == sizeof(int32_t)) return @((int64_t)*(int32_t *)&value);
    return size == sizeof(int64_t) ? @(value) : nil;
}

static NSString *sysctlString(const char *name) {
    char buffer[256] = {0}; size_t size = sizeof(buffer) - 1;
    if (sysctlbyname(name, buffer, &size, NULL, 0) != 0) return nil;
    return stringProperty([NSString stringWithUTF8String:buffer]);
}

char *guanlan_system(int includeProcesses) {
    @autoreleasepool {
        NSMutableDictionary *report = [NSMutableDictionary dictionary];
        NSNumber *files = sysctlInteger("kern.num_files"); if (files) report[@"OpenFiles"] = files;
        int capacity = includeProcesses ? proc_listallpids(NULL, 0) : 0;
        if (capacity > 0) {
            capacity += 64;
            pid_t *pids = calloc((size_t)capacity, sizeof(pid_t));
            int count = pids ? proc_listallpids(pids, capacity * (int)sizeof(pid_t)) : 0;
            if (count > 0) {
                uint64_t threads = 0; int readable = 0;
                for (int i = 0; i < count; i++) {
                    struct proc_taskinfo info;
                    if (pids[i] > 0 && proc_pidinfo(pids[i], PROC_PIDTASKINFO, 0, &info, sizeof(info)) == sizeof(info)) {
                        threads += (uint64_t)MAX(info.pti_threadnum, 0); readable++;
                    }
                }
                report[@"Processes"] = @(count);
                report[@"ReadableProcesses"] = @(readable);
                report[@"Threads"] = @(threads);
            }
            free(pids);
        }
        NSNumber *levels = sysctlInteger("hw.nperflevels");
        NSMutableArray *perf = [NSMutableArray array];
        for (int level = 0; levels && level < MIN(levels.intValue, 8); level++) {
            char key[64]; NSMutableDictionary *item = [NSMutableDictionary dictionary];
            snprintf(key, sizeof(key), "hw.perflevel%d.name", level); NSString *name = sysctlString(key); if (name) item[@"Name"] = name;
            snprintf(key, sizeof(key), "hw.perflevel%d.physicalcpu", level); NSNumber *physical = sysctlInteger(key); if (physical) item[@"Physical"] = physical;
            snprintf(key, sizeof(key), "hw.perflevel%d.logicalcpu", level); NSNumber *logical = sysctlInteger(key); if (logical) item[@"Logical"] = logical;
            snprintf(key, sizeof(key), "hw.perflevel%d.l2cachesize", level); NSNumber *l2 = sysctlInteger(key); if (l2) item[@"L2"] = l2;
            snprintf(key, sizeof(key), "hw.perflevel%d.l3cachesize", level); NSNumber *l3 = sysctlInteger(key); if (l3) item[@"L3"] = l3;
            [perf addObject:item];
        }
        report[@"PerfLevels"] = perf;
        NSNumber *l2 = sysctlInteger("hw.l2cachesize"); if (l2) report[@"L2"] = l2;
        NSNumber *l3 = sysctlInteger("hw.l3cachesize"); if (l3) report[@"L3"] = l3;
        int token = 0; uint64_t state = 0;
        if (notify_register_check("com.apple.system.thermalpressurelevel", &token) == NOTIFY_STATUS_OK) {
            if (notify_get_state(token, &state) == NOTIFY_STATUS_OK) report[@"ThermalPressure"] = @(state);
            notify_cancel(token);
        }
        NSNumber *pressure = sysctlInteger("kern.memorystatus_vm_pressure_level"); if (pressure) report[@"MemoryPressure"] = pressure;
        return extraJSON(report);
    }
}

// ---------------------------------------------------------------- HID temperatures

typedef void *HIDClient; typedef void *HIDService; typedef void *HIDEvent;
typedef HIDClient (*HIDCreate)(CFAllocatorRef);
typedef int (*HIDSetMatching)(HIDClient, CFDictionaryRef);
typedef CFArrayRef (*HIDCopyServices)(HIDClient);
typedef CFTypeRef (*HIDCopyProperty)(HIDService, CFStringRef);
typedef HIDEvent (*HIDCopyEvent)(HIDService, int64_t, int32_t, int64_t);
typedef double (*HIDFloatValue)(HIDEvent, int32_t);

char *guanlan_hid_temperatures(void) {
    @autoreleasepool {
        static HIDCreate create; static HIDSetMatching setMatching; static HIDCopyServices copyServices;
        static HIDCopyProperty copyProperty; static HIDCopyEvent copyEvent; static HIDFloatValue floatValue;
        static HIDClient client = NULL; static BOOL attempted = NO;
        NSMutableDictionary *report = [NSMutableDictionary dictionary];
        if (!attempted) {
            attempted = YES;
            void *iokit = dlopen("/System/Library/Frameworks/IOKit.framework/IOKit", RTLD_LAZY | RTLD_LOCAL);
            if (iokit) {
                create = dlsym(iokit, "IOHIDEventSystemClientCreate"); setMatching = dlsym(iokit, "IOHIDEventSystemClientSetMatching");
                copyServices = dlsym(iokit, "IOHIDEventSystemClientCopyServices"); copyProperty = dlsym(iokit, "IOHIDServiceClientCopyProperty");
                copyEvent = dlsym(iokit, "IOHIDServiceClientCopyEvent"); floatValue = dlsym(iokit, "IOHIDEventGetFloatValue");
            }
            if (create && setMatching && copyServices && copyProperty && copyEvent && floatValue) {
                client = create(kCFAllocatorDefault);
                // Apple vendor page 0xff00, usage 5: on-die temperature sensors.
                if (client) setMatching(client, (__bridge CFDictionaryRef)@{@"PrimaryUsagePage": @0xff00, @"PrimaryUsage": @5});
            }
        }
        if (!client) { report[@"Error"] = @"IOHIDEventSystem unavailable"; report[@"Sensors"] = @[]; return extraJSON(report); }
        NSMutableArray *sensors = [NSMutableArray array];
        CFArrayRef services = copyServices(client);
        if (services) {
            for (CFIndex i = 0; i < CFArrayGetCount(services) && i < 512; i++) {
                HIDService service = (HIDService)CFArrayGetValueAtIndex(services, i);
                CFTypeRef product = copyProperty(service, CFSTR("Product"));
                NSString *name = stringProperty((__bridge id)product);
                if (product) CFRelease(product);
                if (!name) continue;
                HIDEvent event = copyEvent(service, 15 /* kIOHIDEventTypeTemperature */, 0, 0);
                if (!event) continue;
                double value = floatValue(event, 15 << 16);
                CFRelease(event);
                if (isfinite(value)) [sensors addObject:@{@"Name": name, @"Value": @(value)}];
            }
            CFRelease(services);
        }
        report[@"Sensors"] = sensors;
        return extraJSON(report);
    }
}

// ---------------------------------------------------------------- IOReport energy and GPU states

typedef CFDictionaryRef (*XCopyChannels)(CFStringRef, CFStringRef, uint64_t, uint64_t, uint64_t);
typedef CFTypeRef (*XCreateSubscription)(void *, CFMutableDictionaryRef, CFMutableDictionaryRef *, uint64_t, CFTypeRef);
typedef CFDictionaryRef (*XCreateSamples)(CFTypeRef, CFMutableDictionaryRef, CFTypeRef);
typedef CFDictionaryRef (*XCreateDelta)(CFDictionaryRef, CFDictionaryRef, CFTypeRef);
typedef CFStringRef (*XChannelString)(CFDictionaryRef);
typedef int64_t (*XIntegerValue)(CFDictionaryRef, int32_t);
typedef int32_t (*XStateCount)(CFDictionaryRef);
typedef CFStringRef (*XStateName)(CFDictionaryRef, int32_t);
typedef int64_t (*XResidency)(CFDictionaryRef, int32_t);

static struct {
    BOOL attempted;
    XCopyChannels copy; XCreateSubscription subscribe; XCreateSamples samples; XCreateDelta delta;
    XChannelString channelName, unitLabel; XIntegerValue integer; XStateCount stateCount; XStateName stateName; XResidency residency;
} ior;

static BOOL loadIOReport(void) {
    if (!ior.attempted) {
        ior.attempted = YES;
        void *library = dlopen("/usr/lib/libIOReport.dylib", RTLD_LAZY | RTLD_LOCAL);
        if (library) {
            ior.copy = dlsym(library, "IOReportCopyChannelsInGroup"); ior.subscribe = dlsym(library, "IOReportCreateSubscription");
            ior.samples = dlsym(library, "IOReportCreateSamples"); ior.delta = dlsym(library, "IOReportCreateSamplesDelta");
            ior.channelName = dlsym(library, "IOReportChannelGetChannelName"); ior.unitLabel = dlsym(library, "IOReportChannelGetUnitLabel");
            ior.integer = dlsym(library, "IOReportSimpleGetIntegerValue"); ior.stateCount = dlsym(library, "IOReportStateGetCount");
            ior.stateName = dlsym(library, "IOReportStateGetNameForIndex"); ior.residency = dlsym(library, "IOReportStateGetResidency");
        }
    }
    return ior.copy && ior.subscribe && ior.samples && ior.delta && ior.channelName && ior.unitLabel && ior.integer && ior.stateCount && ior.stateName && ior.residency;
}

typedef struct { CFStringRef group, subgroup; CFMutableDictionaryRef channels; CFTypeRef subscription; CFDictionaryRef previous; double previousTime; BOOL attempted; } Sampler;

// Returns the delta channel array since the previous call, or nil on the
// first sample, after a reset, or when the window is implausible.
static NSArray *samplerDelta(Sampler *sampler, double *seconds, NSString **error) {
    if (!loadIOReport()) { *error = @"IOReport unavailable"; return nil; }
    if (!sampler->attempted) {
        sampler->attempted = YES;
        CFDictionaryRef raw = ior.copy(sampler->group, sampler->subgroup, 0, 0, 0);
        if (raw) { sampler->channels = CFDictionaryCreateMutableCopy(NULL, 0, raw); CFRelease(raw); }
        CFMutableDictionaryRef output = NULL;
        if (sampler->channels) sampler->subscription = ior.subscribe(NULL, sampler->channels, &output, 0, NULL);
        if (output) CFRelease(output);
    }
    if (!sampler->subscription) { *error = @"IOReport group not exposed"; return nil; }
    CFDictionaryRef current = ior.samples(sampler->subscription, sampler->channels, NULL);
    double now = NSProcessInfo.processInfo.systemUptime;
    if (!current) { if (sampler->previous) CFRelease(sampler->previous); sampler->previous = NULL; *error = @"IOReport sampling failed"; return nil; }
    NSArray *result = nil;
    // Energy over a window is a valid average at any slow interval the Agent
    // accepts; only an implausible gap (> 1 h, e.g. a long sleep) is dropped.
    if (sampler->previous && now > sampler->previousTime && now - sampler->previousTime <= 3600) {
        CFDictionaryRef diff = ior.delta(sampler->previous, current, NULL);
        if (diff) {
            id raw = (__bridge id)CFDictionaryGetValue(diff, CFSTR("IOReportChannels"));
            if ([raw isKindOfClass:[NSArray class]]) result = [raw copy];
            CFRelease(diff);
            *seconds = now - sampler->previousTime;
        }
    } else *error = @"IOReport baseline warming or wake gap";
    if (sampler->previous) CFRelease(sampler->previous);
    sampler->previous = current; sampler->previousTime = now;
    return result;
}

char *guanlan_energy(void) {
    @autoreleasepool {
        static Sampler energy; static Sampler gpu;
        if (!energy.group) { energy.group = CFSTR("Energy Model"); energy.subgroup = NULL; }
        if (!gpu.group) { gpu.group = CFSTR("GPU Stats"); gpu.subgroup = CFSTR("GPU Performance States"); }
        NSMutableDictionary *report = [NSMutableDictionary dictionary];
        double seconds = 0; NSString *error = nil;
        NSArray *channels = samplerDelta(&energy, &seconds, &error);
        if (channels) {
            NSMutableArray *items = [NSMutableArray array];
            for (NSDictionary *channel in channels) {
                if (![channel isKindOfClass:[NSDictionary class]]) continue;
                CFDictionaryRef item = (__bridge CFDictionaryRef)channel;
                NSString *name = (__bridge NSString *)ior.channelName(item);
                NSString *unit = (__bridge NSString *)ior.unitLabel(item);
                if (!name) continue;
                [items addObject:@{@"Name": name, @"Unit": unit ?: @"", @"Value": @(ior.integer(item, 0))}];
            }
            report[@"Energy"] = items; report[@"EnergySeconds"] = @(seconds);
        } else if (error) report[@"EnergyError"] = error;
        seconds = 0; error = nil;
        NSArray *states = samplerDelta(&gpu, &seconds, &error);
        if (states) {
            NSMutableArray *items = [NSMutableArray array];
            for (NSDictionary *channel in states) {
                if (![channel isKindOfClass:[NSDictionary class]]) continue;
                CFDictionaryRef item = (__bridge CFDictionaryRef)channel;
                NSString *name = (__bridge NSString *)ior.channelName(item); int32_t n = ior.stateCount(item);
                if (!name || n < 1 || n > 128) continue;
                NSMutableArray *list = [NSMutableArray array];
                for (int32_t i = 0; i < n; i++) {
                    NSString *label = (__bridge NSString *)ior.stateName(item, i);
                    [list addObject:@{@"Name": label ?: @"unknown", @"Residency": @(ior.residency(item, i))}];
                }
                [items addObject:@{@"Name": name, @"States": list}];
            }
            report[@"GPUStates"] = items;
        } else if (error) report[@"GPUStatesError"] = error;
        // GPU DVFS table. M1-M3 publish it as voltage-states9; newer SoCs add an
        // -sram suffix. Values are decoded and validated in Go.
        io_registry_entry_t pmgr = IORegistryEntryFromPath(kIOMainPortDefault, "IODeviceTree:/arm-io/pmgr");
        if (pmgr) {
            for (NSString *property in @[@"voltage-states9-sram", @"voltage-states9"]) {
                CFTypeRef raw = IORegistryEntryCreateCFProperty(pmgr, (__bridge CFStringRef)property, NULL, 0);
                if (raw && CFGetTypeID(raw) == CFDataGetTypeID() && CFDataGetLength(raw) <= 128 * 8) {
                    report[@"GPUTable"] = hexBytes(CFDataGetBytePtr(raw), (size_t)CFDataGetLength(raw));
                    CFRelease(raw); break;
                }
                if (raw) CFRelease(raw);
            }
            IOObjectRelease(pmgr);
        }
        return extraJSON(report);
    }
}

// ---------------------------------------------------------------- battery and power adapter

char *guanlan_power_sources(void) {
    @autoreleasepool {
        NSMutableDictionary *report = [NSMutableDictionary dictionary];
        CFTypeRef info = IOPSCopyPowerSourcesInfo();
        if (info) {
            CFStringRef providing = IOPSGetProvidingPowerSourceType(info);
            if (providing) report[@"Providing"] = (__bridge NSString *)providing;
            CFArrayRef list = IOPSCopyPowerSourcesList(info);
            if (list) {
                for (CFIndex i = 0; i < CFArrayGetCount(list); i++) {
                    CFDictionaryRef description = IOPSGetPowerSourceDescription(info, CFArrayGetValueAtIndex(list, i));
                    NSDictionary *d = (__bridge NSDictionary *)description;
                    if (![d isKindOfClass:[NSDictionary class]] || ![d[@kIOPSTypeKey] isEqual:@kIOPSInternalBatteryType]) continue;
                    NSMutableDictionary *battery = [NSMutableDictionary dictionary];
                    for (NSString *key in @[@kIOPSCurrentCapacityKey, @kIOPSMaxCapacityKey, @kIOPSTimeToEmptyKey, @kIOPSTimeToFullChargeKey]) {
                        NSNumber *value = numberProperty(d[key]); if (value) battery[key] = value;
                    }
                    for (NSString *key in @[@kIOPSIsChargingKey, @kIOPSIsChargedKey, @kIOPSIsPresentKey]) {
                        if ([d[key] isKindOfClass:[NSNumber class]]) battery[key] = d[key];
                    }
                    NSString *state = stringProperty(d[@kIOPSPowerSourceStateKey]); if (state) battery[@kIOPSPowerSourceStateKey] = state;
                    NSString *health = stringProperty(d[@kIOPSBatteryHealthKey]); if (health) battery[@kIOPSBatteryHealthKey] = health;
                    report[@"Battery"] = battery;
                    break;
                }
                CFRelease(list);
            }
            CFRelease(info);
        }
        CFDictionaryRef adapter = IOPSCopyExternalPowerAdapterDetails();
        if (adapter) {
            NSNumber *watts = numberProperty(((__bridge NSDictionary *)adapter)[@kIOPSPowerAdapterWattsKey]);
            if (watts) report[@"AdapterWatts"] = watts;
            CFRelease(adapter);
        }
        io_registry_entry_t smart = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("AppleSmartBattery"));
        if (smart) {
            CFMutableDictionaryRef properties = NULL;
            if (IORegistryEntryCreateCFProperties(smart, &properties, kCFAllocatorDefault, 0) == KERN_SUCCESS && properties) {
                NSDictionary *p = (__bridge NSDictionary *)properties;
                NSMutableDictionary *registry = [NSMutableDictionary dictionary];
                for (NSString *key in @[@"CycleCount", @"DesignCapacity", @"MaxCapacity", @"AppleRawMaxCapacity", @"NominalChargeCapacity",
                                        @"CurrentCapacity", @"AppleRawCurrentCapacity", @"Temperature", @"Voltage", @"Amperage", @"InstantAmperage",
                                        @"PermanentFailureStatus"]) {
                    NSNumber *value = numberProperty(p[key]);
                    // Amperage is a signed register published through an
                    // unsigned CF number on some models; keep the bit pattern.
                    if (value) registry[key] = @([value longLongValue]);
                }
                for (NSString *key in @[@"ExternalConnected", @"IsCharging", @"FullyCharged"]) {
                    if ([p[key] isKindOfClass:[NSNumber class]]) registry[key] = p[key];
                }
                report[@"SmartBattery"] = registry;
                CFRelease(properties);
            }
            IOObjectRelease(smart);
        }
        return extraJSON(report);
    }
}

// ---------------------------------------------------------------- per-process GPU time

// Each GPU user client records its creating process ("pid 123, Name") and an
// AppUsage list with cumulative GPU nanoseconds. This is the counter Activity
// Monitor's GPU column is built on; it needs no privileged sampler.
char *guanlan_gpu_clients(void) {
    @autoreleasepool {
        NSMutableDictionary *byPID = [NSMutableDictionary dictionary];
        int accelerators = 0, withUsage = 0;
        io_iterator_t iterator = 0;
        if (IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &iterator) == KERN_SUCCESS) {
            io_registry_entry_t accelerator;
            while ((accelerator = IOIteratorNext(iterator))) {
                accelerators++;
                io_iterator_t children = 0;
                if (IORegistryEntryGetChildIterator(accelerator, kIOServicePlane, &children) == KERN_SUCCESS) {
                    io_registry_entry_t child;
                    while ((child = IOIteratorNext(children))) {
                        CFTypeRef creator = IORegistryEntryCreateCFProperty(child, CFSTR("IOUserClientCreator"), kCFAllocatorDefault, 0);
                        CFTypeRef usage = IORegistryEntryCreateCFProperty(child, CFSTR("AppUsage"), kCFAllocatorDefault, 0);
                        NSString *owner = stringProperty((__bridge id)creator);
                        int pid = 0;
                        if (owner && sscanf(owner.UTF8String, "pid %d", &pid) == 1 && pid > 0 && usage && CFGetTypeID(usage) == CFArrayGetTypeID()) {
                            withUsage++;
                            uint64_t total = 0;
                            for (id entry in (__bridge NSArray *)usage) {
                                if (![entry isKindOfClass:[NSDictionary class]]) continue;
                                NSNumber *time = numberProperty(((NSDictionary *)entry)[@"accumulatedGPUTime"]);
                                if (time && time.doubleValue >= 0) total += time.unsignedLongLongValue;
                            }
                            NSString *key = [NSString stringWithFormat:@"%d", pid];
                            byPID[key] = @([byPID[key] unsignedLongLongValue] + total);
                        }
                        if (creator) CFRelease(creator);
                        if (usage) CFRelease(usage);
                        IOObjectRelease(child);
                    }
                    IOObjectRelease(children);
                }
                IOObjectRelease(accelerator);
            }
            IOObjectRelease(iterator);
        }
        return extraJSON(@{@"Accelerators": @(accelerators), @"Clients": @(withUsage), @"GPUTime": byPID});
    }
}
