# Guanlan / 观澜 v3.0.56（测试版）

## Web 命令面板关闭验收时序修订

- Web visual regression 在 Carbon Modal 关闭后的 React 卸载完成后再验证命令面板，避免把异步渲染提交窗口误判为交互失败。

本版本为测试版 release，不代表稳定生产发布。
