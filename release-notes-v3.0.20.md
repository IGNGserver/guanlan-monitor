# 观澜 v3.0.20 测试版

修复 v3.0.19 中 Windows 无 GUI 安装无法确认上报的问题，并修正无 GUI 验收中的两处断言缺陷。

### 修复

1. **Windows 服务找不到采集器**
   - 安装器把命令行工具放在 `bin\guanlan-agent.exe`，而采集器在 `resources\agent\`。
     服务注册时没有告诉守护进程采集器在哪里，于是它按“与自己同目录”的默认值去找
     `bin\device-state-console-agent.exe`，找不到就不启动采集：服务在运行，但一条数据都不上报。
   - Linux 之所以正常，是因为 deb 里 CLI 与采集器本来就同目录。
   - 修复：
     - `service install` 新增 `--bundle-root`，Windows 安装器显式传入
       `$INSTDIR\resources\agent`；
     - 守护进程在默认目录找不到采集器时，会回退到可执行文件旁的
       `resources\agent`，手工布局也能工作；
     - 服务命令行参数现在逐个加引号：SCM 与 schtasks 会按空格拆分，
       未加引号的 `C:\Program Files\...` 会被拆成多个参数。

2. **无 GUI 验收断言**
   - Linux 侧“卸载保留配置”的检查以普通用户执行 `test -f /etc/guanlan/...`，而该目录是
     `0700` 且属主为服务账户，普通用户无法穿越目录，导致断言误报失败；现在这些检查以
     管理员身份执行（目录不可读本身就是设计要求）。
   - Windows 侧安装失败时现在会输出 `status --json`、服务状态、机器配置目录与后端日志尾部，
     不再只给出一个退出码。

3. **发布闸门**
   - v3.0.19 的两个无 GUI 验收 job 失败时，`publish` job 已被正确跳过，未产出 Release；
     本次仍保持该闸门。

本版本仅作为 GitHub prerelease 测试版发布，不更新 `latest`，不用于生产部署。
