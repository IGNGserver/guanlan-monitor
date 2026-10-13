#!/bin/bash
# Read-only physical-host evidence. Never installs software or changes services.
# Do not include raw IORegistry dumps: they may contain device serial numbers.
set -euo pipefail
output="${1:?output evidence file required}"
python3 - "$output" <<'PY'
import json, subprocess, sys, datetime, plistlib
def run(command):
    result=subprocess.run(command,capture_output=True,timeout=30)
    return result
def text(command):
    result=run(command)
    return result.stdout.decode(errors='replace').strip() if result.returncode==0 else None
accelerators=run(['/usr/sbin/ioreg','-r','-c','IOAccelerator','-a'])
keys=[]
if accelerators.returncode==0 and accelerators.stdout.strip():
    for device in plistlib.loads(accelerators.stdout):
        keys.append(sorted(device.get('PerformanceStatistics',{}).keys()))
report={
    'schemaVersion':1,
    'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'os':text(['/usr/bin/sw_vers','-productVersion']),
    'processArchitecture':text(['/usr/bin/uname','-m']),
    'hardwareModel':text(['/usr/sbin/sysctl','-n','hw.model']),
    'cpuModel':text(['/usr/sbin/sysctl','-n','machdep.cpu.brand_string']),
    'physicalCores':text(['/usr/sbin/sysctl','-n','hw.physicalcpu']),
    'logicalCores':text(['/usr/sbin/sysctl','-n','hw.logicalcpu']),
    'appleSilicon':text(['/usr/sbin/sysctl','-n','hw.optional.arm64'])=='1',
    'translated':text(['/usr/sbin/sysctl','-n','sysctl.proc_translated'])=='1',
    'gpuPerformanceKeys':keys,
    'physicalHardwareAttested':False,
    'measurementParityVerified':False,
    'note':'Inventory only; VM identity can impersonate a Mac. Physical-host and load/reference measurements must be separately attested.'
}
with open(sys.argv[1],'w') as file: json.dump(report,file,ensure_ascii=False,indent=2)
print('Saved redacted inventory:',sys.argv[1])
PY
