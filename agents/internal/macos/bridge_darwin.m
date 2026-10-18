//go:build darwin && cgo

// Read-only Darwin bridge. Private APIs are optional and dynamically resolved;
// missing symbols are a capability failure, not a launch/linker failure.
#import <Foundation/Foundation.h>
#import <IOKit/IOKitLib.h>
#include <mach/mach.h>
#include <sys/sysctl.h>
#include <dlfcn.h>
#include <math.h>

static char *jsonCopy(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    if (!data) return NULL;
    char *copy = malloc(data.length + 1);
    if (!copy) return NULL;
    memcpy(copy, data.bytes, data.length); copy[data.length] = 0; return copy;
}
char *guanlan_plist_json(const void *bytes, size_t length) {
    @autoreleasepool {
        id object = [NSPropertyListSerialization propertyListWithData:[NSData dataWithBytes:bytes length:length] options:NSPropertyListImmutable format:nil error:nil];
        return object ? jsonCopy(object) : NULL;
    }
}
char *guanlan_memory(void) {
    @autoreleasepool {
        uint64_t total=0; size_t size=sizeof(total);
        if (sysctlbyname("hw.memsize",&total,&size,NULL,0)) return NULL;
        mach_port_t host=mach_host_self(); vm_size_t page=0;
        vm_statistics64_data_t vm={0}; mach_msg_type_number_t count=HOST_VM_INFO64_COUNT;
        kern_return_t status=host_page_size(host,&page);
        if (status==KERN_SUCCESS) status=host_statistics64(host,HOST_VM_INFO64,(host_info64_t)&vm,&count);
        mach_port_deallocate(mach_task_self(),host);
        if (status!=KERN_SUCCESS) return NULL;
        struct xsw_usage swap={0}; size=sizeof(swap);
        // Do not turn an unreadable swap statistic into a valid zero.
        if (sysctlbyname("vm.swapusage",&swap,&size,NULL,0)) return NULL;
        NSMutableDictionary *report=[@{@"Total":@(total),@"Page":@(page),@"Internal":@(vm.internal_page_count),@"Purgeable":@(vm.purgeable_count),@"Wired":@(vm.wire_count),@"Compressor":@(vm.compressor_page_count),@"External":@(vm.external_page_count),@"SwapTotal":@(swap.xsu_total),@"SwapUsed":@(swap.xsu_used)} mutableCopy];
        // Kernel memory-pressure kevent level (1 normal, 2 warn, 4 critical);
        // optional, an unreadable value is simply omitted.
        int pressure=0; size=sizeof(pressure);
        if (!sysctlbyname("kern.memorystatus_vm_pressure_level",&pressure,&size,NULL,0)) report[@"Pressure"]=@(pressure);
        return jsonCopy(report);
    }
}

// AppleSMC user-client ABI. Only commands 8 (key enumeration), 9 (metadata)
// and 5 (read bytes) are used. There is deliberately no write API here.
typedef struct { uint8_t major,minor,build,reserved; uint16_t release; } SMCVersion;
typedef struct { uint16_t version,length; uint32_t cpu,gpu,memory; } SMCLimits;
typedef struct { uint32_t size,type; uint8_t attributes; } SMCInfo;
typedef struct { uint32_t key; SMCVersion version; SMCLimits limits; SMCInfo info; uint8_t result,status,command; uint32_t index; uint8_t bytes[32]; } SMCData;
_Static_assert(sizeof(SMCData)==80, "unexpected AppleSMC ABI layout");
static uint32_t fourcc(const char *key) { return ((uint32_t)(uint8_t)key[0]<<24)|((uint32_t)(uint8_t)key[1]<<16)|((uint32_t)(uint8_t)key[2]<<8)|(uint8_t)key[3]; }
static void keyString(uint32_t key,char out[5]) { for (int i=0;i<4;i++) out[i]=(key>>(24-8*i))&255; out[4]=0; }
static BOOL smcCall(io_connect_t connection,SMCData *input,SMCData *output) {
    size_t size=sizeof(*output); memset(output,0,size);
    return IOConnectCallStructMethod(connection,2,input,sizeof(*input),output,&size)==KERN_SUCCESS && size==sizeof(*output) && output->result==0;
}
static BOOL smcRead(io_connect_t connection,uint32_t key,SMCData *value) {
    SMCData input={0}, info={0}; input.key=key; input.command=9;
    if (!smcCall(connection,&input,&info) || info.info.size==0 || info.info.size>32) return NO;
    input.info.size=info.info.size; input.command=5;
    if (!smcCall(connection,&input,value)) return NO;
    value->info=info.info; return YES;
}
static NSArray *readSMC(NSMutableDictionary *report) {
    NSMutableArray *values=[NSMutableArray array];
    io_service_t service=IOServiceGetMatchingService(kIOMainPortDefault,IOServiceMatching("AppleSMC"));
    io_connect_t connection=0;
    kern_return_t status=service ? IOServiceOpen(service,mach_task_self(),0,&connection) : kIOReturnNotFound;
    if (service) IOObjectRelease(service);
    if (status!=KERN_SUCCESS) { report[@"SMCError"]=@"AppleSMC unavailable or permission denied"; return values; }
    SMCData count={0}; uint32_t keys=0;
    if (smcRead(connection,fourcc("#KEY"),&count) && count.info.size==4) keys=((uint32_t)count.bytes[0]<<24)|((uint32_t)count.bytes[1]<<16)|((uint32_t)count.bytes[2]<<8)|count.bytes[3];
    if (!keys || keys>8192) { report[@"SMCError"]=@"invalid AppleSMC key count"; IOServiceClose(connection); return values; }
    for (uint32_t index=0;index<keys;index++) {
        SMCData input={0},entry={0},value={0}; input.command=8; input.index=index;
        if (!smcCall(connection,&input,&entry)) continue;
        char key[5]; keyString(entry.key,key);
        // Power keys are read-only rail/system power sensors (W, flt).
        BOOL power=!strcmp(key,"PSTR")||!strcmp(key,"PCPC")||!strcmp(key,"PCPT")||!strcmp(key,"PG0R")||!strcmp(key,"PDTR")||!strcmp(key,"PPBR");
        if (key[0]!='T' && !power && !(key[0]=='F' && (key[2]=='A'||key[2]=='M') && (key[3]=='c'||key[3]=='d'))) continue;
        if (!smcRead(connection,entry.key,&value)) continue;
        char type[5]; keyString(value.info.type,type);
        NSString *name=[NSString stringWithUTF8String:key], *kind=[NSString stringWithUTF8String:type];
        if (!name || !kind) continue;
        // NSData -> base64 maps directly to Go []byte; no endian assumptions here.
        NSString *data=[[NSData dataWithBytes:value.bytes length:value.info.size] base64EncodedStringWithOptions:0];
        [values addObject:@{@"Key":name,@"Type":kind,@"Data":data}];
    }
    IOServiceClose(connection); return values;
}

static NSNumber *number(id value,double min,double max) {
    if (![value isKindOfClass:[NSNumber class]]) return nil;
    double n=[value doubleValue]; return isfinite(n) && n>=min && n<=max ? value : nil;
}
static NSArray *readGPUs(NSMutableDictionary *report) {
    NSMutableArray *gpus=[NSMutableArray array]; io_iterator_t iterator=0;
    if (IOServiceGetMatchingServices(kIOMainPortDefault,IOServiceMatching("IOAccelerator"),&iterator)!=KERN_SUCCESS) { report[@"GPUError"]=@"IOAccelerator unavailable"; return gpus; }
    io_object_t service;
    while ((service=IOIteratorNext(iterator))) {
        CFMutableDictionaryRef properties=NULL;
        if (IORegistryEntryCreateCFProperties(service,&properties,kCFAllocatorDefault,0)==KERN_SUCCESS && properties) {
            NSDictionary *p=(__bridge NSDictionary *)properties; id raw=p[@"PerformanceStatistics"];
            NSDictionary *stats=[raw isKindOfClass:[NSDictionary class]] ? raw : @{};
            NSString *class=[p[@"IOClass"] isKindOfClass:[NSString class]] ? p[@"IOClass"] : @"Unknown GPU";
            NSString *model=[stats[@"model"] isKindOfClass:[NSString class]] ? stats[@"model"] : class;
            BOOL unified=[[class lowercaseString] containsString:@"agx"];
            BOOL integrated=unified || [[class lowercaseString] containsString:@"intel"];
            io_string_t registryPath={0};
            if (IORegistryEntryGetPath(service,kIOServicePlane,registryPath)!=KERN_SUCCESS) { CFRelease(properties); IOObjectRelease(service); continue; }
            NSString *path=[NSString stringWithUTF8String:registryPath];
            NSMutableDictionary *gpu=[@{@"ID":path,@"Name":model,@"Class":class,@"MemoryKind":unified?@"unified":integrated?@"shared":@"unknown"} mutableCopy];
            NSNumber *usage=number(stats[@"Device Utilization %"],0,100) ?: number(stats[@"GPU Activity(%)"],0,100);
            if (usage) gpu[@"Usage"]=usage;
            NSNumber *clock=number(stats[@"Core Clock(MHz)"],1,10000); if (clock) gpu[@"Frequency"]=clock;
            NSNumber *temperature=number(stats[@"Temperature(C)"],1,125); if (temperature) gpu[@"Temperature"]=temperature;
            // These are allocation counters, never total machine RAM. No made-up
            // "VRAM total" for unified memory when a driver supplies no budget.
            NSNumber *used=number(stats[@"vramUsedBytes"],0,1e15); if (used) gpu[@"MemoryUsed"]=used;
            NSNumber *total=number(stats[@"vramTotalBytes"],1,1e15); if (total && !integrated) { gpu[@"MemoryTotal"]=total; gpu[@"MemoryKind"]=@"dedicated"; }
            [gpus addObject:gpu]; CFRelease(properties);
        }
        IOObjectRelease(service);
    }
    IOObjectRelease(iterator); if (!gpus.count) report[@"GPUError"]=@"no GPU accelerator exposed";
    return gpus;
}

// IOReport is undocumented and optional. Read only explicit MHz/GHz labels;
// state indices without a validated DVFM mapping are returned as unavailable.
typedef CFDictionaryRef (*CopyChannels)(CFStringRef,CFStringRef,uint64_t,uint64_t,uint64_t);
typedef CFTypeRef (*CreateSubscription)(void *,CFMutableDictionaryRef,CFMutableDictionaryRef *,uint64_t,CFTypeRef);
typedef CFDictionaryRef (*CreateSamples)(CFTypeRef,CFMutableDictionaryRef,CFTypeRef);
typedef CFDictionaryRef (*CreateDelta)(CFDictionaryRef,CFDictionaryRef,CFTypeRef);
typedef CFStringRef (*ChannelString)(CFDictionaryRef);
typedef int32_t (*StateCount)(CFDictionaryRef);
typedef CFStringRef (*StateName)(CFDictionaryRef,int32_t);
typedef int64_t (*Residency)(CFDictionaryRef,int32_t);
static NSArray *frequencyTable(NSString *channel) {
    NSString *property=nil;
    if ([channel hasPrefix:@"ECPU"] || [channel isEqualToString:@"CPU0"]) property=@"voltage-states1-sram";
    else if ([channel hasPrefix:@"PCPU"] || [channel isEqualToString:@"CPU1"]) property=@"voltage-states5-sram";
    else if ([channel hasPrefix:@"MCPU"]) property=@"voltage-states22-sram";
    if (!property) return @[];
    io_registry_entry_t pmgr=IORegistryEntryFromPath(kIOMainPortDefault,"IODeviceTree:/arm-io/pmgr");
    if (!pmgr) return @[];
    CFTypeRef raw=IORegistryEntryCreateCFProperty(pmgr,(__bridge CFStringRef)property,NULL,0);
    // E-cluster table moved on M5. Never reuse a P table for unknown clusters.
    if (!raw && [property isEqualToString:@"voltage-states1-sram"]) raw=IORegistryEntryCreateCFProperty(pmgr,CFSTR("voltage-states9-sram"),NULL,0);
    IOObjectRelease(pmgr);
    NSMutableArray *table=[NSMutableArray array];
    if (raw && CFGetTypeID(raw)==CFDataGetTypeID()) {
        CFDataRef data=(CFDataRef)raw; CFIndex length=CFDataGetLength(data);
        const uint8_t *bytes=CFDataGetBytePtr(data); double previousMHz=0;
        if (length>0 && length%8==0 && length<=128*8) for (CFIndex offset=0;offset<length;offset+=8) {
            uint32_t frequency=(uint32_t)bytes[offset]|((uint32_t)bytes[offset+1]<<8)|((uint32_t)bytes[offset+2]<<16)|((uint32_t)bytes[offset+3]<<24);
            double mhz=frequency>=100000000 ? frequency/1000000.0 : frequency/1000.0;
            if (mhz<100 || mhz>10000 || mhz<=previousMHz) { [table removeAllObjects]; break; }
            [table addObject:@(mhz)]; previousMHz=mhz;
        }
    }
    if (raw) CFRelease(raw);
    return table;
}
static NSArray *readFrequency(NSMutableDictionary *report) {
    static BOOL attempted=NO; static void *library=NULL;
    static CopyChannels copy; static CreateSubscription subscribe; static CreateSamples samples;
    static CreateDelta delta; static ChannelString channelName; static StateCount stateCount;
    static StateName stateName; static Residency residency;
    static CFMutableDictionaryRef channels=NULL; static CFTypeRef subscription=NULL;
static CFDictionaryRef previous=NULL; static double previousTime=0;
    NSMutableArray *result=[NSMutableArray array];
    if (!attempted) {
        attempted=YES; library=dlopen("/usr/lib/libIOReport.dylib",RTLD_LAZY|RTLD_LOCAL);
        if (library) {
            copy=dlsym(library,"IOReportCopyChannelsInGroup"); subscribe=dlsym(library,"IOReportCreateSubscription");
            samples=dlsym(library,"IOReportCreateSamples"); delta=dlsym(library,"IOReportCreateSamplesDelta");
            channelName=dlsym(library,"IOReportChannelGetChannelName"); stateCount=dlsym(library,"IOReportStateGetCount");
            stateName=dlsym(library,"IOReportStateGetNameForIndex"); residency=dlsym(library,"IOReportStateGetResidency");
        }
        if (copy && subscribe && samples && delta && channelName && stateCount && stateName && residency) {
            CFDictionaryRef raw=copy(CFSTR("CPU Stats"),CFSTR("CPU Complex Performance States"),0,0,0);
            if (raw) { channels=CFDictionaryCreateMutableCopy(NULL,0,raw); CFRelease(raw); }
            CFMutableDictionaryRef output=NULL;
            if (channels) subscription=subscribe(NULL,channels,&output,0,NULL);
            if (output) CFRelease(output);
        }
    }
    if (!subscription) { report[@"FrequencyError"]=@"IOReport CPU states unavailable"; return result; }
    CFDictionaryRef current=samples(subscription,channels,NULL);
    double now=NSProcessInfo.processInfo.systemUptime;
    if (!current) { if (previous) CFRelease(previous); previous=NULL; report[@"FrequencyError"]=@"IOReport sampling failed"; return result; }
    if (previous && now>previousTime && now-previousTime<=300) {
        CFDictionaryRef diff=delta(previous,current,NULL);
        if (diff) {
            id raw=(__bridge id)CFDictionaryGetValue(diff,CFSTR("IOReportChannels"));
            if ([raw isKindOfClass:[NSArray class]]) for (NSDictionary *channel in raw) {
                if (![channel isKindOfClass:[NSDictionary class]]) continue;
                CFDictionaryRef item=(__bridge CFDictionaryRef)channel;
                NSString *name=(__bridge NSString *)channelName(item); int32_t n=stateCount(item);
                if (!name || n<1 || n>128) continue;
                NSMutableArray *states=[NSMutableArray array];
                for (int32_t i=0;i<n;i++) {
                    NSString *label=(__bridge NSString *)stateName(item,i);
                    [states addObject:@{@"Name":label ?: @"unknown",@"Residency":@(residency(item,i))}];
                }
                [result addObject:@{@"Name":name,@"States":states,@"Table":frequencyTable(name)}];
            }
            CFRelease(diff);
        }
    } else report[@"FrequencyError"]=@"IOReport baseline warming or wake gap";
    if (previous) CFRelease(previous); previous=current; previousTime=now;
    return result;
}
char *guanlan_hardware(void) {
    @autoreleasepool {
        NSMutableDictionary *report=[NSMutableDictionary dictionary];
        int arm64=0; size_t size=sizeof(arm64);
        sysctlbyname("hw.optional.arm64",&arm64,&size,NULL,0);
        // A C comparison boxes as a number (0/1), not a JSON boolean.
        report[@"AppleSilicon"]=arm64==1 ? @YES : @NO;
        report[@"GPUs"]=readGPUs(report); report[@"SMC"]=readSMC(report);
        report[@"CPUChannels"]=readFrequency(report);
        return jsonCopy(report);
    }
}
