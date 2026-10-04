import React from "react";
import { Icon } from "../m3e/icons";
import { M3Button } from "../m3e/primitives";

/**
 * Render-failure containment.
 *
 * Nothing used to catch a render exception, so one malformed payload or one
 * broken chart replaced the whole console with a blank document. A boundary
 * keeps the failure inside the region that produced it: the page frame stays
 * usable, navigation still works, and the reader can retry in place.
 *
 * `resetKey` clears the failure when what is on screen changes (another route,
 * another device), so leaving a broken page does not leave it broken.
 */
interface RenderBoundaryProps {
  children: React.ReactNode;
  /** `page` replaces a route; `tile` replaces one chart card. */
  scope: "page" | "tile";
  /** Card title shown in the tile-scoped fallback. */
  title?: string;
  resetKey?: string;
}

interface RenderBoundaryState {
  error: Error | null;
  resetKey: string | undefined;
}

export class RenderBoundary extends React.Component<RenderBoundaryProps, RenderBoundaryState> {
  state: RenderBoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<RenderBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(props: RenderBoundaryProps, state: RenderBoundaryState): Partial<RenderBoundaryState> | null {
    if (props.resetKey === state.resetKey) return null;
    return { resetKey: props.resetKey, error: null };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error(`[guanlan] ${this.props.scope} render failed`, error, info.componentStack);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.scope === "tile") {
      return (
        <article className="m3e-card m3e-card--filled chart-tile render-boundary render-boundary--tile" role="alert">
          <div className="chart-tile__header"><div className="chart-tile__titles"><h3 className="chart-tile__title">{this.props.title ?? "图表"}</h3></div></div>
          <div className="chart-tile__empty">
            <span>这张图暂时无法显示</span>
            <M3Button variant="text" size="sm" onClick={this.retry}>重试</M3Button>
          </div>
        </article>
      );
    }
    return (
      <section className="workspace-empty m3-state-surface m3-state-surface--error render-boundary" role="alert">
        <div className="workspace-empty__mark"><Icon name="warning" size={22} /></div>
        <h3>页面显示出错</h3>
        <p>这一页在渲染时遇到问题，其余页面仍可使用。可以重试，或从导航进入其他页面。</p>
        <M3Button variant="filled" onClick={this.retry}>重试</M3Button>
        <details className="render-boundary__details"><summary>错误详情</summary><pre>{error.message}</pre></details>
      </section>
    );
  }
}
