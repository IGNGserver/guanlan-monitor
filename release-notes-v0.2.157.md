# v0.2.157

- 修正 Windows runner 生成 Linux CLI 安装脚本时的 UTF-8 BOM 和 CRLF 换行问题。
- CLI Release 安装入口现在可直接由 Linux `bash` 执行，并在 Actions 中校验脚本编码和换行格式。
