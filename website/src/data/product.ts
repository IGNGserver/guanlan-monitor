/**
 * 产品事实的唯一来源（站点侧）。每一条都能在产品仓库找到出处：
 *   README.md（安装、连接、部署、发布规则）、docs/TRUSTED_REALTIME_MONITORING.md（实时查看）、
 *   release-notes-v3.*.md（测试版改动）。改文案前先核对产品仓库，不得编造未发布能力。
 * 最近一次核对：2026-10-24，产品 VERSION = 3.0.167。
 */

export const REPO = 'IGNGserver/guanlan-monitor';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const README_URL = `${REPO_URL}#readme`;
export const COMPOSE_URL = `${REPO_URL}/blob/main/docker-compose.yml`;
export const ENV_EXAMPLE_URL = `${REPO_URL}/blob/main/.env.example`;
export const REALTIME_DOC_URL = `${REPO_URL}/blob/main/docs/TRUSTED_REALTIME_MONITORING.md`;
export const SITE_REPO_URL = 'https://github.com/IGNGserver/guanlan-monitor/tree/main/website';

/** 中枢对外端口（README「连接中枢」；v3.0.135 起由 3100 调整为 38472）。 */
export const HUB_PORT = 38472;

export const SUMMARY =
  '观澜是用于查看电脑和服务器运行状态的私有部署监控工具。它提供 Web 控制台、Windows 桌面端、GNOME Linux 桌面端和 Android 客户端，可查看 CPU、内存、磁盘、网络、显卡和风扇等实时数据与历史趋势。';

// ------------------------------------------------------------------ 发布资产

export type AssetKey = 'winSetup' | 'winPortable' | 'winUpdate' | 'deb' | 'apk';

export interface AssetSpec {
  key: AssetKey;
  platform: 'Windows' | 'Linux' | 'Android';
  label: string;
  pattern: RegExp;
  note: string;
  primary?: boolean;
}

/** 命名规则与用途见产品 README「下载与安装」「发布规则」。 */
export const ASSETS: AssetSpec[] = [
  {
    key: 'winSetup',
    platform: 'Windows',
    label: '安装程序',
    pattern: /^DeviceStateConsole-Windows-Setup-v[\d.]+\.exe$/,
    note: '安装到 %ProgramFiles%\\DeviceStateConsoleAgent，创建快捷方式并注册开机自启的机器级 Agent 服务；支持静默安装、更新和卸载。',
    primary: true,
  },
  {
    key: 'winPortable',
    platform: 'Windows',
    label: '便携版',
    pattern: /^DeviceStateConsole-Windows-Portable-v[\d.]+\.zip$/,
    note: '无需安装的 Windows 便携版。',
  },
  {
    key: 'winUpdate',
    platform: 'Windows',
    label: '更新包',
    pattern: /^DeviceStateConsole-Windows-Update-v[\d.]+\.zip$/,
    note: '仅用于已安装客户端的更新分发，不应作为首次安装方式。',
  },
  {
    key: 'deb',
    platform: 'Linux',
    label: '.deb 安装包',
    pattern: /^DeviceStateConsole-Linux-Install-v[\d.]+\.deb$/,
    note: '适用于 Ubuntu / Debian amd64（以 Ubuntu 24.04 构建）。提供 /usr/bin/guanlan 桌面端与 guanlan-agent 命令，并启用系统级 guanlan-agent.service。',
    primary: true,
  },
  {
    key: 'apk',
    platform: 'Android',
    label: 'APK',
    pattern: /^DeviceStateConsole-Android-v[\d.]+\.apk$/,
    note: '使用 IGNGserver 发布证书签名。首次打开填写与 Windows 端相同的中枢地址和查看密钥。',
    primary: true,
  },
];

export interface ReleaseAsset {
  name: string;
  size: number;
  url: string;
}

export interface ReleaseInfo {
  tag: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  assets: Partial<Record<AssetKey, ReleaseAsset>>;
}

const dl = (tag: string, name: string) => `${REPO_URL}/releases/download/${tag}/${name}`;

/**
 * 构建时拿不到 GitHub API（离线构建、限流）时使用的烘焙值。
 * 2026-10-24 核对：最新发布为 v3.0.167（正式版，GitHub Latest）。
 */
export const FALLBACK_RELEASE: ReleaseInfo = (() => {
  const tag = 'v3.0.167';
  const sizes: Record<AssetKey, [string, number]> = {
    winSetup: ['DeviceStateConsole-Windows-Setup-v3.0.167.exe', 104924899],
    winPortable: ['DeviceStateConsole-Windows-Portable-v3.0.167.zip', 149463842],
    winUpdate: ['DeviceStateConsole-Windows-Update-v3.0.167.zip', 149463842],
    deb: ['DeviceStateConsole-Linux-Install-v3.0.167.deb', 98682568],
    apk: ['DeviceStateConsole-Android-v3.0.167.apk', 9337890],
  };
  const assets: ReleaseInfo['assets'] = {};
  for (const [key, [name, size]] of Object.entries(sizes) as [AssetKey, [string, number]][]) {
    assets[key] = { name, size, url: dl(tag, name) };
  }
  return {
    tag,
    url: `${REPO_URL}/releases/tag/${tag}`,
    publishedAt: '2026-10-24T13:57:56Z',
    prerelease: false,
    assets,
  };
})();

// ------------------------------------------------------------------ 观测对象（与 3D 模型的层一一对应）

export interface Layer {
  id: 'lens' | 'fan' | 'gpu' | 'cpu' | 'mem' | 'disk' | 'net';
  index: string;
  name: string;
  code: string;
  lead: string;
  metrics: string[];
  note?: string;
}

/** 自上而下的剖切顺序。指标名称取自控制台界面文案。 */
export const LAYERS: Layer[] = [
  {
    id: 'lens',
    index: '00',
    name: '观测窗',
    code: 'OBSERVE',
    lead: '看到的，就是测到的。',
    metrics: ['设备未提供的传感器显示为空', '首次尚无差分基线时标为不可用', '暂时失败的结果标注「N 秒前」'],
    note: '不以零冒充，也不阻塞设备上线。',
  },
  {
    id: 'fan',
    index: '01',
    name: '风扇',
    code: 'FAN',
    lead: '每一只风扇单独成列。',
    metrics: ['风扇转速', '按风扇实例展示'],
    note: '主板或驱动未暴露转速时，对应读数留空。',
  },
  {
    id: 'gpu',
    index: '02',
    name: '显卡',
    code: 'GPU',
    lead: '负载、编解码、频率、显存、核心温度。',
    metrics: ['核心负载', '编码 / 解码负载', 'GPU 频率', '显存已用容量', '核心温度'],
    note: 'v3.0.158 起，实时进程列表增加进程级 GPU 占用。',
  },
  {
    id: 'cpu',
    index: '03',
    name: '处理器',
    code: 'CPU',
    lead: '使用率、频率与温度。',
    metrics: ['CPU 使用率', 'CPU 频率', 'CPU 温度（Package / Core）'],
  },
  {
    id: 'mem',
    index: '04',
    name: '内存',
    code: 'MEMORY',
    lead: '物理内存与已提交内存。',
    metrics: ['内存占用', '物理与已提交内存', '历史水位'],
  },
  {
    id: 'disk',
    index: '05',
    name: '磁盘',
    code: 'STORAGE',
    lead: '驱动器、挂载点与 I/O。',
    metrics: ['挂载点容量', '读写速率', '磁盘温度'],
    note: '单个缺失的磁盘容量不会把整台机器的容量清零。',
  },
  {
    id: 'net',
    index: '06',
    name: '网络',
    code: 'NETWORK',
    lead: '物理网卡吞吐与流量日历。',
    metrics: ['收发速率', '流量带宽', '历史流量日历'],
  },
];

/** 控制台时间范围（设备详情页）。 */
export const RANGES = ['实时', '5 分钟', '1 小时', '6 小时', '24 小时', '7 天'];

// ------------------------------------------------------------------ 客户端

export const CLIENTS = [
  {
    id: 'web',
    name: 'Web 控制台',
    sys: 'Browser',
    points: ['使用 .env 中的 ACCESS_KEY 登录', '总览、设备目录、接入中枢、设备详情与设置', '窄屏底栏保留四个目的地'],
  },
  {
    id: 'windows',
    name: 'Windows 桌面端',
    sys: 'Windows',
    points: ['在「配置」页填写中枢地址、访问密钥和设备名称', '常驻系统托盘：左键主界面，右键查看状态或退出', '关闭窗口或注销登录不会中断采集'],
  },
  {
    id: 'linux',
    name: 'GNOME Linux 桌面端',
    sys: 'Linux',
    points: ['/usr/bin/guanlan，在「连接」页填写中枢', '非提权用户只能查看状态', '修改机器级配置需要管理员权限'],
  },
  {
    id: 'android',
    name: 'Android 客户端',
    sys: 'Android',
    points: ['填写中枢地址和查看密钥', '支持 https:// 与 http://', '未配置 TLS 时仅建议在可信局域网使用 HTTP'],
  },
] as const;

// ------------------------------------------------------------------ 无人值守

export const WIN_SILENT = `& "DeviceStateConsole-Windows-Setup-vX.Y.Z.exe" /S \`
    /HUB="https://hub.example.com" /KEY="<ACCESS_KEY>" \`
    /DEVICE=node-01 /HOSTNAME="节点01" /VERIFY=120`;

export const LINUX_SILENT = `sudo GUANLAN_HUB=https://hub.example.com GUANLAN_KEY="$KEY" GUANLAN_DEVICE_ID=node-01 \\
  apt-get install -y ./DeviceStateConsole-Linux-Install-vX.Y.Z.deb
sudo guanlan-agent wait-for-upload --timeout 120   # 退出码 0 表示已确认上报`;

export const AGENT_COMMANDS: [string, string][] = [
  ['status [--json]', '服务 / 配置 / 上报状态；退出码 0/3/4/5 可用于编排'],
  ['doctor [--json]', '服务 + 配置 + 中枢连通性检查'],
  ['config get|set|validate|export|import', '读写机器级配置'],
  ['service install|uninstall|start|stop|status', '管理机器级服务'],
  ['collector start|stop|restart', '控制采集器'],
  ['probes status|detect', '硬件探针状态与检测'],
  ['wait-for-upload --timeout N', '等待首次上报确认'],
  ['onboarding-url', '输出接入地址'],
];

// ------------------------------------------------------------------ 中枢部署

export const HUB_ENV_KEYS = ['SESSION_SECRET', 'ACCESS_KEY', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'REDIS_PASSWORD'];

export const HUB_SERVICES = [
  { id: 'web', name: 'web', role: '控制台与 /api 代理', port: `${HUB_PORT} → 3000` },
  { id: 'server', name: 'server', role: '中枢服务：上报、鉴权、实时通道', port: '4000（仅容器内）' },
  { id: 'redis', name: 'redis', role: '短窗口实时序列', port: '内部' },
  { id: 'mysql', name: 'mysql', role: '分钟 / 小时历史', port: '内部' },
] as const;

export const HUB_ADDRESSES = [
  ['局域网 HTTP', `http://服务器IP:${HUB_PORT}`],
  ['局域网', `https://服务器域名:${HUB_PORT}`],
  ['公网', 'https://你的域名'],
  ['受控 HTTP 内网穿透', 'http://公网IP:转发端口'],
] as const;

// ------------------------------------------------------------------ 实时查看（docs/TRUSTED_REALTIME_MONITORING.md）

export const REALTIME_FACTS: [string, string][] = [
  ['1 / 2 / 5 秒', '查询间隔可选；仅在面板展开、页面可见、登录有效时查询'],
  ['15 秒租约', '中枢每 5 秒发送随机 challenge，只接受匹配的 pong 续期'],
  ['5 秒截止', '每个查询先 ACK 再返回通过 schema 校验的结果'],
  ['900 毫秒', '同一结果供所有观看者共用；设备端每个主题约每秒最多采集一次'],
  ['2 分钟', '实时曲线最多保留 120 个点，缺失处留断点，不写入历史库'],
];
