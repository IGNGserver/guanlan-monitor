# 观澜官网 · Guanlan Website

观澜 / Guanlan 的产品官网与下载入口，源码位于产品仓库的 `website/`：

- 产品仓库（唯一事实来源）：<https://github.com/IGNGserver/guanlan-monitor>
- 正式站点：<https://guanlan.igng.net/>（Cloudflare Pages 项目 `guanlan-website`）
- 部署：`.github/workflows/website.yml` 在 `main` 和正式发版后自动构建并上传 `dist/`

## 目录结构

- `src/`：Astro 7 静态站点 + three.js（首屏 3D 观测单元，空闲时懒加载）；
- `design/`：3D 观测单元的几何定义（`observatory.json`）、Blender 构建脚本与母版，
  设计规范见 `design/DESIGN.md`；
- `public/`：静态资产（`observatory.glb`、OG 图、图标、`robots.txt`、`sitemap.xml`、`_headers`）；
- `tests/`：Playwright 端到端检查与产品事实核对；
- `docs/SITE.md`、`docs/HOSTING.md`、`docs/WORKSPACE.md`：站点规范、部署与工作区约定。

## 开发

```bash
cd website
pnpm install --frozen-lockfile --ignore-workspace
pnpm build        # astro check + astro build
pnpm test         # Playwright；先 build
```

`--ignore-workspace` 是必需的：`website/` 位于产品 pnpm workspace 内，但不属于它；不加这个标志
pnpm 会去安装产品根的 workspace，而不会在 `website/` 生成 `node_modules`。

构建与测试不要落在 NAS 项目卷上；在 `$BUILD_SCRATCH_ROOT` 的副本里安装/构建，步骤见
[`docs/WORKSPACE.md`](docs/WORKSPACE.md)。部署由 GitHub Actions 自动执行。

## 许可

[MIT](../LICENSE)
