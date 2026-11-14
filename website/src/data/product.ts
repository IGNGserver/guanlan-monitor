/**
 * 产品事实的唯一来源（站点侧）。每一条都能在产品仓库找到出处：
 *   README.md（定位与能力）、docs/INSTALL.md（安装、连接、部署、外部数据库、发布规则）、
 *   docs/TRUSTED_REALTIME_MONITORING.md（实时查看与凭据恢复）、
 *   docs/EXTERNAL_DATABASE.md（外部 MySQL / Redis）、docs/CLIENT_UPDATES.md（静态源更新）、
 *   .github/release-notes/v3.*.md。改文案前先核对产品仓库，不得编造未发布能力。
 * 最近一次核对：2026-11-14，产品 VERSION = 3.0.174（最近正式版 v3.0.172）。
 */

export const REPO = 'IGNGserver/guanlan-monitor';
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases`;
export const README_URL = `${REPO_URL}#readme`;
export const COMPOSE_URL = `${REPO_URL}/blob/main/docker-compose.yml`;
export const EXTERNAL_COMPOSE_URL = `${REPO_URL}/blob/main/docker-compose.external.yml`;
export const ENV_EXAMPLE_URL = `${REPO_URL}/blob/main/.env.example`;
export const INSTALL_DOC_URL = `${REPO_URL}/blob/main/docs/INSTALL.md`;
export const REALTIME_DOC_URL = `${REPO_URL}/blob/main/docs/TRUSTED_REALTIME_MONITORING.md`;
export const EXTERNAL_DB_DOC_URL = `${REPO_URL}/blob/main/docs/EXTERNAL_DATABASE.md`;
export const CLIENT_UPDATES_DOC_URL = `${REPO_URL}/blob/main/docs/CLIENT_UPDATES.md`;
export const SITE_REPO_URL = 'https://github.com/IGNGserver/guanlan-monitor/tree/main/website';

/** 中枢对外端口（README「连接中枢」；v3.0.135 起由 3100 调整为 38472）。 */
export const HUB_PORT = 38472;

export const SUMMARY =
  '观澜是用于查看电脑和服务器运行状态的私有部署监控工具。它提供 Web 控制台（PWA）、Windows 桌面端、GNOME Linux 桌面端和 Android 客户端，支持设备分组、宿主机存储池、90 天流量日历以及进程与容器的实时双向直查。';

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

/** 命名规则与用途见产品 README「下载与安装」与 docs/INSTALL.md「发布规则」。 */
export const ASSETS: AssetSpec[] = [
  {
    key: 'winSetup',
    platform: 'Windows',
    label: '安装程序',
    pattern: /^DeviceStateConsole-Windows-Setup-v[\d.]+\.exe$/,
    note: '安装到 %ProgramFiles%\\DeviceStateConsoleAgent，创建快捷方式并注册开机自启的机器级 Agent 服务；支持 /S 静默安装、guanlan-agent update 升级与卸载。',
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
    note: '使用 IGNGserver 发布证书签名。支持 One UI 数据优先总览、平板横屏导航栏与三款主屏幕小组件。',
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
 * 2026-11-14 核对：最新构建为 v3.0.174（测试版通道，prerelease=true）；最近正式稳定版为 v3.0.172。
 */
export const FALLBACK_RELEASE: ReleaseInfo = (() => {
  const tag = 'v3.0.174';
  const sizes: Record<AssetKey, [string, number]> = {
    winSetup: ['DeviceStateConsole-Windows-Setup-v3.0.174.exe', 104906998],
    winPortable: ['DeviceStateConsole-Windows-Portable-v3.0.174.zip', 149439127],
    winUpdate: ['DeviceStateConsole-Windows-Update-v3.0.174.zip', 149439127],
    deb: ['DeviceStateConsole-Linux-Install-v3.0.174.deb', 98466436],
    apk: ['DeviceStateConsole-Android-v3.0.174.apk', 9403426],
  };
  const assets: ReleaseInfo['assets'] = {};
  for (const [key, [name, size]] of Object.entries(sizes) as [AssetKey, [string, number]][]) {
    assets[key] = { name, size, url: dl(tag, name) };
  }
  return {
    tag,
    url: `${REPO_URL}/releases/tag/${tag}`,
    publishedAt: '2026-11-07T14:44:52Z',
    prerelease: true,
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
    lead: '看到的，就是测到的；掉线处如实留断口。',
    metrics: [
      '设备未提供的传感器显示为空',
      '离线或缺失区间断开曲线，不画跨停机假直线',
      '告警与严重阈值虚线同轴标出',
      '暂时失败的结果标注「N 秒前」',
    ],
    note: '首次尚无差分基线时标为不可用，不以零冒充，也不阻塞设备上线。',
  },
  {
    id: 'fan',
    index: '01',
    name: '风扇',
    code: 'FAN',
    lead: '每一只风扇单独成列。',
    metrics: ['风扇转速（RPM）', '按风扇实例独立展示与命名'],
    note: '主板或驱动未暴露转速时，对应读数留空。',
  },
  {
    id: 'gpu',
    index: '02',
    name: '显卡',
    code: 'GPU',
    lead: '多卡逐实例展示，兼顾进程级最忙引擎。',
    metrics: [
      '核心负载与编码 / 解码负载',
      'GPU 频率与核心温度',
      '显存已用 / 总容量与水位告警',
      '实时进程列表采集最忙 GPU 引擎占用',
    ],
    note: '多显卡机器按实例分列；实时进程支持按 GPU 占用一键排序。',
  },
  {
    id: 'cpu',
    index: '03',
    name: '处理器',
    code: 'CPU',
    lead: '使用率、运行频率与封装温度。',
    metrics: ['整机 CPU 使用率与保极值降采样', '实时与历史运行频率', 'CPU 温度（Package / Core）'],
  },
  {
    id: 'mem',
    index: '04',
    name: '内存',
    code: 'MEMORY',
    lead: '物理、已提交、缓存与交换空间分层呈现。',
    metrics: [
      '物理内存与缓存 / 可用容量',
      '已提交内存（超出物理上限时坐标轴线性自扩展）',
      'Swap 交换空间水位与历史趋势',
    ],
  },
  {
    id: 'disk',
    index: '05',
    name: '磁盘与存储池',
    code: 'STORAGE',
    lead: '从物理驱动器、挂载点到虚拟化宿主机存储池。',
    metrics: [
      '挂载点容量、读写速率与进程级磁盘 I/O',
      '物理盘温度与 SMART 健康状态',
      'Proxmox VE / LVM-thin（含元数据水位）/ ZFS / NFS 存储池',
      '自动排除虚拟机单盘噪声，保留宿主机真实池容量',
    ],
    note: '单个缺失的磁盘容量不会把整台机器的容量清零。',
  },
  {
    id: 'net',
    index: '06',
    name: '网络',
    code: 'NETWORK',
    lead: '物理网卡吞吐、链路速率与 90 天流量日历。',
    metrics: [
      '收发速率（自动过滤回环与虚拟隧道噪声）',
      '物理网卡类型与协商链路速率',
      '按日累计的 90 天收发流量日历',
    ],
  },
];

/** 控制台时间范围（设备详情页）。 */
export const RANGES = ['实时', '5 分钟', '1 小时', '6 小时', '24 小时', '7 天'];

// ------------------------------------------------------------------ 舰队与分组（示意数据）

export interface FleetDeviceDemo {
  id: string;
  name: string;
  group: 'pve' | 'build' | 'nas';
  os: string;
  online: boolean;
  health: 'teal' | 'amber' | 'danger' | 'off';
  cpu: (number | null)[];
  mem: (number | null)[];
  disk: (number | null)[];
}

export interface FleetAttentionDemo {
  severity: 'danger' | 'amber' | 'off';
  badge: string;
  group: 'pve' | 'build' | 'nas';
  device: string;
  detail: string;
  age: string;
}

export interface StoragePoolDemo {
  name: string;
  kind: string;
  host: string;
  group: 'pve' | 'build' | 'nas';
  usedTb: number;
  totalTb: number;
  metaPct?: number;
}

export const FLEET_GROUPS = [
  { id: 'all', name: '全部设备', count: '5 / 6', dot: 'amber' as const, sub: '跨 3 个自定义分组汇聚' },
  { id: 'pve', name: '虚拟化集群', count: '2 / 2', dot: 'amber' as const, sub: 'Proxmox VE 宿主机与存储池' },
  { id: 'build', name: '编译与开发', count: '2 / 3', dot: 'off' as const, sub: '桌面工作站与构建节点' },
  { id: 'nas', name: '核心存储', count: '1 / 1', dot: 'teal' as const, sub: 'ZFS / NFS 主存储阵列' },
] as const;

export const FLEET_DEVICES: FleetDeviceDemo[] = [
  {
    id: 'pve-01',
    name: 'pve-node-01',
    group: 'pve',
    os: 'PVE · Debian',
    online: true,
    health: 'teal',
    cpu: [31, 34, 29, 38, 42, 36, 33, 40, 44, 39, 35, 37],
    mem: [68, 68, 69, 70, 70, 71, 71, 72, 72, 71, 71, 72],
    disk: [58, 58, 59, 59, 59, 60, 60, 60, 61, 61, 61, 61],
  },
  {
    id: 'pve-02',
    name: 'pve-node-02',
    group: 'pve',
    os: 'PVE · Debian',
    online: true,
    health: 'amber',
    cpu: [46, 52, 49, 61, 67, 58, 54, 63, 71, 66, 62, 64],
    mem: [79, 80, 81, 82, 83, 83, 84, 85, 86, 85, 84, 85],
    disk: [81, 82, 82, 83, 83, 84, 84, 85, 85, 86, 86, 86],
  },
  {
    id: 'ws-01',
    name: 'workstation-01',
    group: 'build',
    os: 'Windows 11',
    online: true,
    health: 'teal',
    cpu: [18, 22, 45, 74, 68, 35, 24, 29, 51, 42, 26, 23],
    mem: [52, 53, 56, 61, 60, 55, 54, 54, 58, 57, 54, 53],
    disk: [44, 44, 44, 45, 45, 45, 45, 45, 46, 46, 46, 46],
  },
  {
    id: 'build-02',
    name: 'linux-builder-02',
    group: 'build',
    os: 'Ubuntu 24.04',
    online: true,
    health: 'teal',
    cpu: [24, 28, 33, 56, 88, 91, 76, 48, 34, 29, 31, 27],
    mem: [46, 47, 49, 58, 66, 67, 61, 52, 48, 47, 47, 46],
    disk: [51, 51, 52, 53, 54, 54, 52, 51, 51, 51, 51, 51],
  },
  {
    id: 'runner-04',
    name: 'ci-runner-04',
    group: 'build',
    os: 'Ubuntu · 无桌面',
    online: false,
    health: 'off',
    // 真实展示「离线留断口，不画跨停机假直线」
    cpu: [39, 42, 47, 51, null, null, null, null, 44, 38, null, null],
    mem: [62, 63, 64, 65, null, null, null, null, 61, 60, null, null],
    disk: [69, 69, 70, 70, null, null, null, null, 70, 70, null, null],
  },
  {
    id: 'nas-01',
    name: 'nas-core',
    group: 'nas',
    os: 'Debian · ZFS',
    online: true,
    health: 'teal',
    cpu: [12, 14, 15, 19, 22, 18, 16, 15, 17, 21, 16, 14],
    mem: [74, 74, 75, 75, 75, 76, 76, 75, 75, 76, 76, 76],
    disk: [64, 64, 64, 65, 65, 65, 65, 65, 65, 66, 66, 66],
  },
];

export const FLEET_ATTENTION: FleetAttentionDemo[] = [
  {
    severity: 'amber',
    badge: '池元数据',
    group: 'pve',
    device: 'pve-node-02',
    detail: 'LVM-thin 存储池 local-lvm 容量 85.8% · 元数据水位 82.4%',
    age: '刚刚',
  },
  {
    severity: 'amber',
    badge: '内存水位',
    group: 'pve',
    device: 'pve-node-02',
    detail: '物理内存占用 85.0%（108.8 / 128.0 GB），超过 80% 提示阈值',
    age: '12 秒前',
  },
  {
    severity: 'off',
    badge: '离线',
    group: 'build',
    device: 'ci-runner-04',
    detail: '超过 120 秒心跳窗口未上报，曲线自动留空断口',
    age: '4 分钟前',
  },
];

export const FLEET_POOLS: StoragePoolDemo[] = [
  { name: 'local-lvm', kind: 'PVE · lvmthin', host: 'pve-node-02', group: 'pve', usedTb: 1.63, totalTb: 1.9, metaPct: 82.4 },
  { name: 'vm-nvme', kind: 'PVE · zfspool', host: 'pve-node-01', group: 'pve', usedTb: 2.18, totalTb: 3.84 },
  { name: 'tank-raidz2', kind: 'ZFS · pool', host: 'nas-core', group: 'nas', usedTb: 18.4, totalTb: 28.8 },
  { name: 'scratch-lvm', kind: 'LVM · vg', host: 'linux-builder-02', group: 'build', usedTb: 0.94, totalTb: 1.8 },
];

// ------------------------------------------------------------------ 客户端与跨端韧性

export const CLIENTS = [
  {
    id: 'web',
    name: 'Web 控制台',
    sys: 'Browser · PWA',
    points: [
      '总览舰队驾驶舱、设备组树、接入中枢、设备详情与设置',
      '自适应触控壳层：手机四项底栏、平板导航栏与 840px 主从分栏',
      '可安装 PWA：原子化壳层校验 + IndexedDB 会话级只读离线快照',
      '弱网自适应（自动 / 标准 / 省流）与 90 天滑动续期登录',
    ],
  },
  {
    id: 'windows',
    name: 'Windows 桌面端',
    sys: 'Windows',
    points: [
      '与 Web 共用工作区界面，统一「连接与本机 Agent」配置页',
      '常驻系统托盘：左键主界面，右键查看状态或退出',
      '关闭窗口或注销登录不会中断机器级服务采集',
      '直连仓库静态更新源校验字节数与 SHA-256 升级',
    ],
  },
  {
    id: 'linux',
    name: 'GNOME Linux 桌面端',
    sys: 'Linux',
    points: [
      '/usr/bin/guanlan 桌面端与随包 guanlan-agent 命令',
      '安装即启用 multi-user.target 系统级 guanlan-agent.service',
      '非提权用户只读查看状态，修改机器级配置需要管理员权限',
      '系统包升级默认保留 /etc/guanlan 机器级配置',
    ],
  },
  {
    id: 'android',
    name: 'Android 客户端',
    sys: 'Android',
    points: [
      'One UI 数据优先总览：核心趋势迷你卡与「关注」告警徽标页',
      '平板与横屏自适应侧边导航栏，四分页直达进程与容器',
      '三款主屏幕小组件：舰队健康、单机仪表盘、流量统计',
      '支持 https:// 与可信局域网 http://，签名与版本号严格校验更新',
    ],
  },
] as const;

export const RESILIENCE_PILLARS = [
  {
    code: 'OFFLINE SNAPSHOT',
    title: 'PWA 会话级离线快照',
    body: 'Service Worker 原子化缓存经过 SHA-256 校验的前端资源，IndexedDB 保留最近访问视图的 24 小时只读快照；退出或 401/403 立即清空。',
  },
  {
    code: 'WEAK-LINK BUDGET',
    title: '弱网自适应与保极值降采样',
    body: '支持自动、标准与省流模式；慢速连接按 pointBudget 做桶内 min/max 保极值降采样，既省流量又不削平短时尖峰。',
  },
  {
    code: 'STATIC FEED UPDATE',
    title: '免鉴权静态源校验更新',
    body: '桌面端、Android、guanlan-agent update 与 Web 直接读取仓库静态 updates.json，不携带中枢凭据，流式核对字节数与 SHA-256，严格禁止降级。',
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
  ['update [--channel stable|preview]', '直连仓库静态更新源，核对字节数与 SHA-256 后调用系统安装器升级'],
  ['config get|set|validate|export|import', '读写机器级配置（密钥经 --key-stdin 或文件传入）'],
  ['service install|uninstall|start|stop|status', '管理机器级服务'],
  ['collector start|stop|restart', '控制采集器'],
  ['probes status|detect', '硬件探针状态与检测'],
  ['wait-for-upload --timeout N', '等待首次上报确认'],
  ['onboarding-url', '输出接入地址'],
];

// ------------------------------------------------------------------ 中枢部署

export const HUB_ENV_KEYS = ['SESSION_SECRET', 'ACCESS_KEY', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'REDIS_PASSWORD'];

export const HUB_SERVICES = [
  { id: 'web', name: 'web', role: '控制台与 /api 反向代理（Nginx）', port: `${HUB_PORT} → 3000` },
  { id: 'server', name: 'server', role: '中枢服务：上报、鉴权、分组与实时通道', port: '4000（仅容器内）' },
  { id: 'redis', name: 'redis', role: '短窗口实时序列与可选 L2 读缓存', port: '内部' },
  { id: 'mysql', name: 'mysql', role: '设备组、分钟 / 小时历史与流量日历', port: '内部' },
] as const;

export const HUB_EXTERNAL_SERVICES = [
  { id: 'web', name: 'web', role: '控制台与 /api 反向代理（Nginx）', port: `${HUB_PORT} → 3000` },
  { id: 'server', name: 'server', role: '中枢服务：DSC_DB_MODE=external 单写者锁', port: '4000（仅容器内）' },
  { id: 'redis', name: '外部 Redis', role: '按 dsc:<DSC_INSTANCE_ID> 命名空间隔离', port: 'REDIS_URL（内网）', external: true },
  { id: 'mysql', name: '外部 MySQL', role: 'MySQL 8.0+ 独立库 + hub_meta 实例校验', port: 'MYSQL_URL（内网）', external: true },
] as const;

export const HUB_ADDRESSES = [
  ['局域网 HTTP', `http://服务器IP:${HUB_PORT}`],
  ['局域网', `https://服务器域名:${HUB_PORT}`],
  ['公网', 'https://你的域名'],
  ['受控 HTTP 内网穿透', 'http://公网IP:转发端口'],
] as const;

// ------------------------------------------------------------------ 实时查看（docs/TRUSTED_REALTIME_MONITORING.md）

export const REALTIME_FACTS: [string, string][] = [
  ['1 / 2 / 5 秒', '按需查询快速性能、进程（CPU / GPU / 磁盘读写 / 内存）与容器；无人查看即零开销'],
  ['15 秒租约', 'Agent 主动连向 /api/agent/realtime，中枢每 5 秒发随机 challenge，只接受匹配的 pong 续期'],
  ['5 秒截止', '每次查询先回 ACK 再返回经 schema 校验的数据；独立差分基线不污染历史序列'],
  ['900 毫秒合并', '同一会话短窗口结果供所有观看者共用，多人同看一台机器也不会放大设备采样负担'],
  ['凭据冲突可恢复', '设备登记独立密钥且中枢只存哈希；重装导致安装 UUID 变化时，控制台可一键重置实时凭据'],
  ['一级入口与 ⌘K', '进程与容器为设备详情一级标签，支持在组内同级切换机器，或用 Ctrl / ⌘ K 命令直达'],
];
