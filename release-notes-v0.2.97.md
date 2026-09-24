# v0.2.97 test release

- extend the agent virtualization adapter layer to libvirt/KVM, direct QEMU, Hyper-V, VirtualBox, vSphere, VMware Workstation, and VMware Fusion;
- collect platform CPU, memory, storage, network, VM inventory, device configuration, and guest-agent data where the host interface exposes it;
- add automatic local hypervisor detection and document environment-only adapter credentials and executable paths;
- add parser coverage for the virtualization host interfaces and validate nested KVM/libvirt/QEMU on the isolated PVE test VM.
