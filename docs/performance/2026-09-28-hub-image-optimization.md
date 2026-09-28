# 中枢端镜像体积与拉取性能优化 — 2026-09-28

## 背景与问题

中枢端（Hub）由 `server`（Fastify API）与 `web`（Next.js UI）两个容器组成，
从 GHCR 拉取、部署耗时明显，落地后占用也不小。

### 实测基线（拉取 GHCR 真实 manifest，2026-09-28）

| 镜像 | 压缩层合计（amd64） | 说明 |
| --- | ---: | --- |
| `device-state-console-web:0.2.118` | **187.8 MiB** | 用户可见的“巨大且慢” |
| `device-state-console-server:0.2.114` | **169.6 MiB** | 与 web 共享同一套臃肿 node_modules |
| `node:22-alpine` 基础层 | 57.9 MiB | 两者都含，无法避免 |
| `mysql:8.4` / `redis:7.4-alpine` | 227.9 / 15.5 MiB | 属基础设施，另有优化空间 |

web 与 server 的应用层几乎同尺寸，说明两者都打包了**同一份被放大的
`node_modules`**，而不是各自的运行时依赖。

## 根因分析

`deploy/docker/*.Dockerfile` 原为单阶段构建：

```
pnpm install --frozen-lockfile          # ← 无 --filter，安装整个 workspace
COPY apps ./apps && COPY packages ./packages
pnpm --filter @dsc/shared build && pnpm --filter @dsc/{web,server} build
CMD 直接以源码 workspace 运行
```

后果：

1. **安装整个 workspace 的依赖闭包**。workspace 含 `apps/desktop`，其
   `electron@37`（含 Linux 二进制）、`electron-builder`、`vite`、`recharts`、
   `@carbon/*` 等全部被写入镜像，尽管 Hub 运行时完全用不到。
2. **零裁剪**：`NODE_ENV=production` 的 `ENV` 出现在 `pnpm install` **之后**，
   因此 devDependencies（TypeScript、tsx、vite、sass…）全部留在最终镜像。
3. **运行时依赖源码树**：以 `pnpm --filter @dsc/web exec next start` 启动，
   需要完整 workspace 解析路径，无法只拷贝产物。
4. **对 `apps/desktop`、`agents`、`android` 等无关目录的上下文变更敏感**，
   缓存失效频繁、构建上下文大。

## 优化方案

采用「构建阶段完整、运行阶段最小」的多阶段构建；web 走 Next standalone，
server 走 `pnpm deploy` 自包含导出。

### web（`deploy/docker/web.Dockerfile`）

| 阶段 | 内容 |
| --- | --- |
| `deps` | `pnpm install --frozen-lockfile --filter @dsc/web...`，只装 web 闭包 |
| `build` | 构建 shared + web，产出 `.next/standalone`（含被 trace 的运行时依赖） |
| `runner` | 只拷贝 `standalone/` + `.next/static` + `public/`，`node apps/web/server.js` 直接启动 |

配套 `apps/web/next.config.mjs`：

- `output: "standalone"`；
- `images: { unoptimized: true }` —— 业务全部使用普通 `<img>`，从未使用
  `next/image`，从而剔除 **sharp + libvips native（~16 MB）**；
- `outputFileTracingExcludes` 剔除被 trace 进运行时的构建期工具
  （`node_modules/typescript`、`sass`、`caniuse-lite`、`sharp`、`@img`）；
- 由 `.ts` 改写为 `.mjs`：standalone 运行时会重新读取该配置，而瘦身后的
  运行时不含 TypeScript，`next.config.ts` 会导致启动 `ERR_MODULE_NOT_FOUND`。

### server（`deploy/docker/server.Dockerfile`）

| 阶段 | 内容 |
| --- | --- |
| `deps` | `pnpm install --frozen-lockfile --filter @dsc/server...` |
| `build` | 构建 shared + server，并 `pnpm deploy /app/runtime --legacy --prod` |
| `runner` | 只拷贝自包含运行时（`dist` + 生产 `node_modules`）+ 空 `data/` |

> 注：`@dsc/shared` 是纯类型包（`export type`），server 侧对它的引用均为
> `import type`，编译后被完全擦除，因此自包含运行时可直接启动。

### 上下文与缓存

- `.dockerignore` 排除 `apps/desktop`、`android`、`ios`、`agents`、`windows-agent`、
  `tools`、`docs`、`deploy`、`.github`，减小上下文并稳定层缓存；
- web 构建阶段不再 `COPY apps`（排除 `apps/desktop`），仅复制
  `packages/{shared,console-ui}` 与 `apps/web`，`apps/desktop` 变更不再使 web 缓存失效。

### 静态资源

- `apps/web/public/{favicon,logo}.png` 原为 **1254×1254、各 1.5 MB 且内容完全相同**，
  而 `manifest.json` 声称它们是 192/512 图。已生成正确尺寸版本：
  favicon 1.5 MB → 31 KB，logo 1.5 MB → 230 KB。

## 实测结果（本地复现构建链路）

| 指标 | 改造前 | 改造后（实测） |
| --- | ---: | ---: |
| web 运行时（standalone + static + public） | 全量 node_modules | **38 MB** |
| server 自包含运行时 | 全量 node_modules | **28 MB** |
| web 安装依赖数 | 全 workspace（含 electron） | 216（不含 electron/desktop） |
| server 依赖闭包测试 | — | 109 包 |
| 运行时启动 | `pnpm … next start` | `node`（无需 pnpm/corepack/TS） |

镜像压缩层预计由 **~188 / ~170 MiB** 降至约 **~90 / ~83 MiB**
（基础层 58 MiB + standalone/运行时），**降幅约 50%+**；拉取与落地占用同步下降。

### 功能回归验证（本地实跑）

- web standalone 启动：`GET /` → 200，CSP / X-Frame-Options 等安全头齐全，
  `/logo.png` → 200，middleware `/api/*` 反代与 `/socket.io` 匹配器保留；
- server 自包含运行时启动至数据库连接阶段（模块解析全部通过）；
- `pnpm typecheck`：通过；
- `pnpm verify:version` / `verify:web-security-headers` / `verify:hub-image` / `verify:hub-port`：通过；
- server 单元测试 28/28 通过；边界检查（desktop-ui / web-ui / adapter-contracts）通过。

> 说明：`.ts` 直跑的 UI 测试在本机 Node（未编译 TypeScript 支持）下无法执行，
> 属环境限制，将在 CI 官方 Node 上运行。

## 新增防回归校验

- `scripts/verify-hub-image-config.mjs`（`pnpm verify:hub-image`）：断言
  standalone 输出、`images.unoptimized`、trace 排除、两个 Dockerfile 的
  最小闭包安装与自包含启动命令；已接入 `ci.yml` 与 `docker-publish.yml`。

## 后续可选项（未在本次实施）

1. **合并 web + server 为单容器**：Next 通过 `rewrites` 直接把 `/api/*` 反代到
   同容器内的 Fastify（`127.0.0.1:4000`），可合并两个镜像（省一份 node 基础层
   与一份依赖），并简化部署；代价是耦合度上升。
2. **`sharp` 按需恢复**：若未来引入 `next/image` 或 AVIF/WebP 动态优化，需移除
   `unoptimized` 与 trace 排除，并重新评估体积。
3. **静态资源 WebP 化**：当前保留 PNG 以零风险（直接替换二进制）。logo 的 WebP
   约 11 KB（较 PNG 230 KB 再降 95%），后续可切换引用并加 `<picture>` 回退。
4. **MySQL 镜像**：`mysql:8.4` 压缩层 228 MiB，可评估更小的发行版或托管数据库，
   属本轮中枢应用镜像之外的独立议题。
5. **libvips/sharp 在 CI 中校验**：可在 `docker-publish` 增加镜像层体积断言，
   防止回归。
