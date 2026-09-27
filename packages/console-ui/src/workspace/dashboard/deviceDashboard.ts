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
      caption: "系统关键指标驾驶舱与容量水位",
      sections: [
        {
          id: "section-overview",
          eyebrow: "驾驶舱",
          title: "核心性能走势",
          description: "处理器、内存、主活动磁盘与核心网络吞吐的综合实时走势。",
          charts: [
            { id: "overview-cpu-average", title: "CPU 平均使用率", visualization: "line", span: "half", requires: ["cpuUsage"] },
            { id: "overview-memory", title: "物理与已提交内存", visualization: "area", span: "half", requires: ["memoryUsage", "memoryCommitted"] },
            { id: "overview-disk-total", title: "活动磁盘总已用", visualization: "area", span: "half", requires: ["diskUsage"] },
            { id: "overview-network-average", title: "核心网卡平均吞吐", visualization: "line", span: "half", requires: ["networkRxRate", "networkTxRate"] }
          ]
        },
        {
          id: "section-overview-capacity",
          eyebrow: "容量",
          title: "资源水位总览",
          description: "关键硬件资源当前占用比例与容量分布。",
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
      name: "计算与系统",
      caption: "CPU 实例负载、主频、温度与系统进程调度",
      sections: [
        {
          id: "section-compute",
          eyebrow: "处理器",
          title: "处理器与系统统计",
          description: "拓扑、核心与系统调度的静态事实，不随时间窗口变化。",
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
          eyebrow: "内存与调度",
          title: "内存层级与系统进程",
          charts: [
            { id: "compute-memory", title: "内存容量明细", visualization: "area", span: "half", requires: ["memoryUsage", "memoryCommitted", "memoryCached", "swapUsage"] },
            { id: "compute-memory-capacity", title: "物理内存占用", visualization: "donut", span: "half", requires: ["memoryUsage"] },
            { id: "compute-system", title: "系统进程、线程与句柄", visualization: "line", span: "half", requires: ["systemOverview"] }
          ]
        }
      ]
    },
    {
      id: "storage",
      name: "存储",
      caption: "磁盘驱动器、挂载点容量与 I/O 读写性能",
      sections: [
        {
          id: "section-storage-disk",
          eyebrow: "硬盘实例",
          title: "硬盘容量与 I/O",
          description: "各磁盘实例的容量占用与实时读写吞吐。",
          charts: [
            { id: "storage-disk-capacity", title: "已用容量", visualization: "area", span: "half", perInstance: "disk", requires: ["diskUsage"] },
            { id: "storage-disk-io", title: "读写速率", visualization: "line", span: "half", perInstance: "disk", requires: ["diskRead", "diskWrite"] }
          ]
        },
        {
          id: "section-storage-summary",
          eyebrow: "容量统计",
          title: "分区水位总览",
          description: "磁盘分区已用空间与系统文件层级分布。",
          charts: [
            { id: "storage-disk-capacity-donut", title: "磁盘占用", visualization: "donut", span: "half", requires: ["diskUsage"] }
          ]
        }
      ]
    },
    {
      id: "network",
      name: "网络",
      caption: "物理网卡吞吐、流量带宽与历史流量日历",
      sections: [
        {
          id: "section-storage-calendar",
          eyebrow: "流量统计",
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
          description: "实时接收与发送带宽，可按接口进行实例筛选。",
          charts: [
            { id: "storage-network-throughput", title: "吞吐", visualization: "line", span: "half", perInstance: "network", requires: ["networkRxRate", "networkTxRate"] }
          ]
        }
      ]
    },
    {
      id: "thermal_hardware",
      name: "硬件与环境",
      caption: "GPU 负载与显存、温度传感器矩阵与风扇转速",
      sections: [
        {
          id: "section-gpu",
          eyebrow: "显卡实例",
          title: "GPU 明细",
          description: "独立显卡负载、编解码、频率、显存和核心温度。",
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
