import type {
  DashboardSpec,
  DashboardTabSpec
} from "./types";

/**
 * 设备详情页的固定图表布局。
 *
 * 这份常量就是「预设布局」本身：选项卡数量、顺序、分区、每张图表的可视化类型
 * 与栅格跨度全部在编译期写死，运行期只读。用户不再能增删选项卡、拖拽图表或
 * 保存自定义面板——小组件机制移除后，这里取代了原来的 `WidgetLayoutDocument`。
 *
 * 维护约定：
 * - `id` 一经发布就不要改，视觉回归测试与页内锚点都依赖它；
 * - 新增图表时优先复用已有的 `visualization` 与 `span` 档位，不要引入一次性跨度；
 * - `requires` 必须如实反映图表依赖的指标，否则设备不适用时会画出空图；
 * - `perInstance` 图表由页面按硬件实例展开，并沿用实例筛选器的选择结果。
 */
export const DEVICE_DASHBOARD = {
  id: "device-dashboard",
  tabs: [
    {
      id: "overview",
      name: "概览",
      caption: "跨硬件的平均趋势与容量占用",
      sections: [
        {
          id: "section-overview",
          eyebrow: "综合遥测",
          title: "硬件平均趋势",
          description: "按类别平均所有已采集实例；单个硬件的独立图表在对应明细选项卡里。",
          charts: [
            { id: "overview-cpu-average", title: "CPU 平均使用率", visualization: "line", span: "half", requires: ["cpuUsage"] },
            { id: "overview-memory", title: "物理与已提交内存", visualization: "area", span: "half", requires: ["memoryUsage", "memoryCommitted"] },
            { id: "overview-disk-total", title: "磁盘总已用容量", visualization: "area", span: "half", requires: ["diskUsage"] },
            { id: "overview-network-average", title: "网卡平均吞吐", visualization: "line", span: "half", requires: ["networkRxRate", "networkTxRate"] },
            { id: "overview-gpu-average", title: "GPU 平均使用率", visualization: "line", span: "half", requires: ["gpuUsage", "gpuEncode", "gpuDecode"] },
            { id: "overview-gpu-memory", title: "GPU 总内存已用容量", visualization: "area", span: "half", requires: ["gpuMemory"] }
          ]
        },
        {
          id: "section-overview-capacity",
          eyebrow: "容量",
          title: "容量占用",
          description: "以当前样本计算的占用比例，用 Carbon 仪表与环形图取代原来的文字摘要。",
          charts: [
            { id: "overview-capacity-memory", title: "物理内存占用", visualization: "donut", span: "quarter", requires: ["memoryUsage"] },
            { id: "overview-capacity-disk", title: "磁盘占用", visualization: "donut", span: "quarter", requires: ["diskUsage"] },
            { id: "overview-capacity-gpu", title: "显存占用", visualization: "donut", span: "quarter", requires: ["gpuMemory"] },
            { id: "overview-capacity-swap", title: "页面文件占用", visualization: "meter", span: "quarter", requires: ["swapUsage"] }
          ]
        },
        {
          id: "section-info",
          eyebrow: "设备信息",
          title: "硬件与 Agent",
          charts: [
            { id: "device-hardware-system", title: "硬件与系统", visualization: "table", span: "half" },
            { id: "device-agent-status", title: "设备 Agent", visualization: "custom", span: "half" }
          ]
        }
      ]
    },
    {
      id: "compute",
      name: "处理器与内存",
      caption: "CPU 实例、频率、温度与内存层级",
      sections: [
        {
          id: "section-compute",
          eyebrow: "处理器",
          title: "处理器与系统统计",
          description: "拓扑、缓存与系统计数的静态事实，不随时间窗口变化。",
          charts: [
            { id: "compute-cpu-facts", title: "处理器与系统统计", visualization: "number", span: "full", requires: ["systemOverview"] }
          ]
        },
        {
          id: "section-compute-cpu",
          eyebrow: "CPU 实例",
          title: "CPU 实例明细",
          description: "每个 Socket 的负载、频率与温度分开呈现，避免不同单位被压缩成一条汇总线。",
          charts: [
            { id: "compute-cpu-usage", title: "使用率", visualization: "line", span: "half", perInstance: "cpu", requires: ["cpuUsage"] },
            { id: "compute-cpu-frequency", title: "主频", visualization: "line", span: "half", perInstance: "cpu", requires: ["cpuFrequency"] },
            { id: "compute-cpu-temperature", title: "温度", visualization: "line", span: "half", perInstance: "cpu", requires: ["cpuTemperature"] }
          ]
        },
        {
          id: "section-compute-memory",
          eyebrow: "内存",
          title: "内存与系统",
          charts: [
            { id: "compute-memory", title: "内存容量明细", visualization: "area", span: "half", requires: ["memoryUsage", "memoryCommitted", "memoryCached", "swapUsage"] },
            { id: "compute-memory-capacity", title: "物理内存占用", visualization: "donut", span: "half", requires: ["memoryUsage"] },
            { id: "compute-system", title: "系统进程、线程与句柄", visualization: "line", span: "half", requires: ["systemOverview"] }
          ]
        }
      ]
    },
    {
      id: "storage_net",
      name: "存储与网络",
      caption: "网卡与硬盘实例的吞吐、容量与 I/O",
      sections: [
        {
          id: "section-storage-calendar",
          eyebrow: "流量",
          title: "流量日历",
          description: "按天聚合的历史流量视图，时间范围与顶部窗口控件独立。",
          charts: [
            { id: "storage-traffic-calendar", title: "流量日历", visualization: "custom", span: "full", requires: ["networkTraffic"] }
          ]
        },
        {
          id: "section-storage",
          eyebrow: "网卡实例",
          title: "网卡吞吐明细",
          charts: [
            { id: "storage-network-throughput", title: "吞吐", visualization: "line", span: "half", perInstance: "network", requires: ["networkRxRate", "networkTxRate"] }
          ]
        },
        {
          id: "section-storage-disk",
          eyebrow: "硬盘实例",
          title: "硬盘容量与 I/O",
          charts: [
            { id: "storage-disk-capacity", title: "已用容量", visualization: "area", span: "half", perInstance: "disk", requires: ["diskUsage"] },
            { id: "storage-disk-io", title: "读写速率", visualization: "line", span: "half", perInstance: "disk", requires: ["diskRead", "diskWrite"] }
          ]
        }
      ]
    },
    {
      id: "gpu_thermal",
      name: "显卡与散热",
      caption: "GPU 负载、显存、温度传感器与风扇转速",
      sections: [
        {
          id: "section-gpu",
          eyebrow: "显卡实例",
          title: "GPU 明细",
          description: "每个 GPU 都有独立的负载、频率、显存和温度数据。",
          charts: [
            { id: "gpu-load", title: "核心负载", visualization: "line", span: "half", perInstance: "gpu", requires: ["gpuUsage"] },
            { id: "gpu-encode", title: "编码负载", visualization: "line", span: "quarter", perInstance: "gpu", requires: ["gpuEncode"] },
            { id: "gpu-decode", title: "解码负载", visualization: "line", span: "quarter", perInstance: "gpu", requires: ["gpuDecode"] },
            { id: "gpu-frequency", title: "核心频率", visualization: "line", span: "half", perInstance: "gpu", requires: ["gpuFrequency"] },
            { id: "gpu-memory", title: "显存已用容量", visualization: "area", span: "half", perInstance: "gpu", requires: ["gpuMemory"] },
            { id: "gpu-temperature", title: "温度", visualization: "line", span: "half", perInstance: "gpu", requires: ["gpuTemperature"] },
            { id: "gpu-driver", title: "驱动信息", visualization: "table", span: "half", perInstance: "gpu", requires: ["gpuDriverInfo"] }
          ]
        },
        {
          id: "section-temperature",
          eyebrow: "散热",
          title: "温度传感器",
          description: "Agent 实际暴露的全部温度源，包含被判定为不可用的传感器。",
          charts: [
            { id: "gpu-temperature-sources", title: "温度传感器", visualization: "custom", span: "full", requires: ["temperatureSources"] }
          ]
        },
        {
          id: "section-fan",
          eyebrow: "散热",
          title: "风扇转速",
          description: "每个风扇接口的当前转速和历史趋势；0 RPM 也会保留，表示该接口确实报告了停转。",
          charts: [
            { id: "fan-rpm", title: "风扇转速", visualization: "line", span: "half", perInstance: "fan", requires: ["fanRpm"] }
          ]
        }
      ]
    }
  ]
} as const satisfies DashboardSpec;

/**
 * 从常量反推出来的 id 联合类型。
 *
 * 这三个类型是「声明即约束」的关键：页面用 `Record<DeviceChartId, …>` 存放每张
 * 图表的渲染器，只要常量里新增了图表而渲染器没有跟上，typecheck 就会失败，
 * 不会出现「布局里写了、页面上永远不显示」的静默缺口。
 */
export type DeviceTabId = (typeof DEVICE_DASHBOARD)["tabs"][number]["id"];
export type DeviceSectionId = (typeof DEVICE_DASHBOARD)["tabs"][number]["sections"][number]["id"];
export type DeviceChartId = (typeof DEVICE_DASHBOARD)["tabs"][number]["sections"][number]["charts"][number]["id"];

/** 固定布局里的全部选项卡 id，顺序即渲染顺序。 */
export const DEVICE_TAB_IDS: readonly DeviceTabId[] = DEVICE_DASHBOARD.tabs.map((tab) => tab.id);

/** 默认选中的选项卡。 */
export const DEFAULT_DEVICE_TAB_ID: DeviceTabId = DEVICE_DASHBOARD.tabs[0].id;

export function findDeviceTab(tabId: string): DashboardTabSpec {
  return DEVICE_DASHBOARD.tabs.find((tab) => tab.id === tabId) ?? DEVICE_DASHBOARD.tabs[0];
}

/** 页内跳转条使用的锚点列表。只有一个分区时不需要跳转条。 */
export function deviceTabAnchors(tab: DashboardTabSpec): Array<{ id: string; label: string }> {
  return tab.sections.map((section) => ({ id: section.id, label: section.title }));
}
