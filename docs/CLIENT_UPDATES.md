# 设备更新机制

桌面端、Android 与随包机器服务直接读取仓库 `updates` 分支的
`https://raw.githubusercontent.com/IGNGserver/guanlan-monitor/updates/updates.json`。
此地址由发布流程生成；不存在、网络失败或格式异常时显示暂不可用，不回退中枢或 GitHub REST API。
更新不需要中枢登录、地址或访问密钥，更新 HTTP client 不携带中枢 cookie 或认证头。

## 通道和版本

- 正式版 `stable` 只接收 `prerelease=false` 且版本无预发布后缀的 Release。
- 预览版 `preview` 接收正式与预发布 Release；按 SemVer 优先级选择最高且具有适配安装包的版本。
- 用户在设置中选择通道并保存在设备上。旧桌面和测试 Android 缺省迁移到 preview；正式 Android 保留 stable。
- 切换通道只影响候选范围，所有入口仍要求候选严格大于当前版本。不会重装相同版本或降级；正式版尚未追上当前预览版时等待更高正式版。
- 只使用精确系统/架构/安装单元以及具有 SHA256 的已上传资产。Windows/Linux 现有安装包仅支持 x64，不将其发给 arm64。

客户端持久保存成功结果、ETag、失败次数和请求冷却截止时间。自动检查间隔六小时并增加最多30分钟抖动；手动检查最少间隔60秒，不能绕过失败退避或服务器 Retry-After / rate-reset。并发检查合并，304复用已有结果；网络失败保留上次结果并显示缓存状态。下载仅在用户点击后进行。

## 安装

桌面“下载 vX.Y.Z 安装包”直接打开该固定 Release 的适配资产 URL；安装由系统安装器完成。
Android 使用独立长下载超时，验证 SHA256、包名、版本名称、严格递增的 Android versionCode 与当前安装签名后，才交系统安装器。当前数字版本可以按构建脚本同一公式计算 versionCode；未来带 SemVer 预发布后缀的 APK 必须在 feed 提供真实 versionCode，否则不作为候选。

机器服务的 `guanlan-agent update --channel stable|preview` 使用相同 feed，通道保存在本机缓存。旧 `test` 是 preview 的兼容别名；旧 `--server-url` / `--secret` 参数仍可解析，但不参与更新请求。Windows 启动完整 setup `/S`，Linux 调用 `dpkg -i`（需管理员权限），由完整安装包维护桌面与机器服务，禁止仅替换旧 CLI 二进制。macOS 继续要求桌面的完整签名 pkg。

机器服务下载逐跳限制为 GitHub 官方 HTTPS 资产域，流式核对 feed 指定的实际字节数和 SHA256；失败关闭并删除临时文件。Windows 等待安装器结束后清理临时 exe；如果安装器终止了调用更新命令的旧进程，临时 exe 可能保留在系统临时目录。旧 `--current-version` 不能伪装成低于当前运行构建的版本来绕过升级限制。

Web/PWA 也直接读取同一 feed 并在本浏览器保存通道、ETag 和冷却状态，只比较当前 Web 构建版本并展示 Release 信息；实际 Web/PWA 仍随站点部署和 service worker 更新，不管理原生应用安装版本。浏览器请求不携带认证、Cookie、Referer 或自定义条件头；Raw GitHub 不支持该条件头的 CORS 预检且不暴露 ETag，因此由浏览器 HTTP 缓存通过 `cache: no-cache` 完成原生 ETag 重验证。应用的 feed/通道/冷却仍持久保存在 localStorage。Web 本机偏好与中枢会话分离，CSP 仅增加 raw.githubusercontent.com 的连接许可。

中枢 `/api/updates` 暂保留给旧客户端及中枢自身更新；上游错误触发指数冷却，尊重限流截止时间，并在可用时复用上次成功数据。新设备不调用此代理。

## 验证

`node --experimental-transform-types --test apps/desktop/src/main/device-updates.test.ts` 覆盖通道、SemVer、资产匹配、并发、持久冷却、304与429。
Go `go test ./... -run 'DeviceFeed|UpdateSemver'` 覆盖直连、通道和冷却。Android `:app:testDebugUnitTest --tests com.dsc.android.UpdateVersionTest` 覆盖版本优先级和现有版本码布局；实际安装器/签名验证仍需真实已签名包与设备验收。
