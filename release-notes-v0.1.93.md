# Device State Console v0.1.93

## Highlights

- Windows 观澜客户端的趋势图统一保留横轴时间与左侧纵轴刻度，长设备名称不会再裁切第二行图表的时间标签。
- CPU 与 GPU 频率图保持从 `0 MHz` 起始的动态刻度；内存、交换分区和磁盘新增已用容量趋势，概览同时显示已用容量、总容量和使用率。
- 中枢历史序列及 Windows 客户端 DTO 已同步扩展容量字段。升级中枢后，新的上报将开始积累容量趋势。
- Windows 安装程序版本提升至 `0.1.93`，可从已安装的 `0.1.92` 进入更新流程。

## Assets

| 文件 | SHA-256 |
| --- | --- |
| `DeviceStateConsoleAgent-setup-0.1.93.exe` | `BCD53A544123CF11A3A8DDA42AAF93738E7CACD376EF0CE11E389DE388820FC2` |
| `DeviceStateConsoleAgent-update-0.1.93.zip` | `0A1E096195EBBF15E83037BD10290F60102353BEB9674D7DA7139CD907860E12` |

现有历史不会补写此前未保存的容量字段；部署中枢更新后会从新的采样记录开始显示容量趋势。
