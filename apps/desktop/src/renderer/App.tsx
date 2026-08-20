import React from "react";
import WorkspaceApp from "@dsc/console-ui";
import "@dsc/console-ui/styles.css";
import appIcon from "@dsc/console-ui/assets/app-icon.png";
import { desktopConsoleAdapter } from "./services/consoleAdapter";

interface AppErrorBoundaryState {
  error: Error | null;
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="workspace-error-boundary" role="alert">
        <img className="workspace-error-boundary__mark-img" src={appIcon} alt="观澜" />
        <h1>本机设置暂时无法显示</h1>
        <p>Agent 返回了无法识别的状态。请重试；如果问题持续，请先重启观澜。</p>
        <button type="button" onClick={() => window.location.reload()}>重新加载</button>
      </main>
    );
  }
}

export const App: React.FC = () => <AppErrorBoundary><WorkspaceApp adapter={desktopConsoleAdapter} /></AppErrorBoundary>;

export default App;
