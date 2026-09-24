# Guanlan Renderer Performance Review

- CI run `30968805986` 已通过 Windows/Linux Electron bundle、typecheck、package smoke test；未在本机执行项目 build/package。
- `pnpm check:desktop-ui-boundaries` 通过，`pnpm test:ui-helpers` 5/5 通过。
- 视觉截图采用发布资产解包后的 renderer 静态运行态，使用 mock 数据；未把截图工具的耗时误当作应用性能指标。
- `v0.2.79` 候选仍遵循同一门禁：不在本机执行项目 build/package，等待 GitHub Actions 产出后再以发布资产完成运行态矩阵检查；不把截图工具耗时误当作应用性能指标。
