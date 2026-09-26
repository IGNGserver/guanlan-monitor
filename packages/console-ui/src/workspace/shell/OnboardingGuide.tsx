import React, { useEffect, useState } from "react";
import { useWorkspace, type SettingsSection } from "../WorkspaceContext";
import { Button, Icon } from "../ui";

const DISMISS_KEY = "dsc-onboarding-dismissed";

interface GuideStep {
  title: string;
  detail: string;
  /** Null when the step is something the user does outside the app. */
  actionLabel?: string;
  actionSection?: SettingsSection;
}

/**
 * The three questions a first run actually asks: where do I get the key, what
 * makes a device appear, and where do I look once it has. Before this existed
 * an empty overview offered one sentence and a settings button, which left
 * nobody less lost than before.
 *
 * The guide is dismissible and remembers it; it only appears while there is
 * nothing to look at, so it cannot interrupt an established workspace.
 */
export function OnboardingGuide() {
  const { allDevices, capabilities, openSettings, openExternal } = useWorkspace();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");
    } catch {
      // A blocked storage area means the guide shows again rather than hides.
      setDismissed(false);
    }
  }, []);
  const hasDevices = allDevices.length > 0;
  // The guide is about getting the first device on screen. Once the fleet has
  // any member at all the console is self-explanatory and this gets out of the
  // way, so it can never interrupt an established workspace.
  const needsGuide = !hasDevices;
  if (dismissed || !needsGuide) return null;
  const steps: GuideStep[] = capabilities.canControlNativeWindow
    ? [
      { title: "连接中枢", detail: "填写中枢地址和访问密钥；密钥由中枢管理员提供。", actionLabel: "打开连接设置", actionSection: "connections" },
      { title: "启动本机 Agent", detail: "Agent 负责采集这台机器的硬件数据。", actionLabel: "打开本机 Agent", actionSection: "agent" },
      { title: "等待第一批数据", detail: "上报一次后，这台设备就会出现在设备目录里。" }
    ]
    : [
      { title: "输入访问密钥", detail: "密钥由中枢管理员提供，只在当前浏览器会话内使用。" },
      { title: "等待设备上报", detail: "目标设备上的 Agent 上报一次后，就会自动出现在这里，不需要手动添加。" },
      { title: "打开设备查看详情", detail: "设备目录支持搜索、筛选和排序；点任一行即可查看完整指标。" }
    ];
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // Preference cannot persist; the guide still closes for this visit.
    }
  };
  return (
    <section className="workspace-onboarding" aria-label="首次使用引导">
      <div className="workspace-onboarding__header">
        <div>
          <span className="workspace-section-kicker">开始使用</span>
          <p className="workspace-onboarding__lead">观澜按这三步接入第一台设备。</p>
        </div>
        <Button variant="quiet" onClick={dismiss} aria-label="关闭首次使用引导">不再显示</Button>
      </div>
      <ol className="workspace-onboarding__steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <span className="workspace-onboarding__index">{index + 1}</span>
            <div className="workspace-onboarding__body">
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
              {step.actionSection && <Button variant="quiet" onClick={() => openSettings(step.actionSection as SettingsSection)}>{step.actionLabel}<Icon name="arrow" size={15} /></Button>}
            </div>
          </li>
        ))}
      </ol>
      <div className="workspace-onboarding__footer">
        <p>需要更完整的部署与 Agent 安装说明？</p>
        <Button variant="quiet" onClick={() => void openExternal("https://github.com/IGNGserver/guanlan-monitor#readme")}>查看文档<Icon name="external" size={14} /></Button>
      </div>
    </section>
  );
}
