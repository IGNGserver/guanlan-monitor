import React, { Suspense, lazy, useMemo, useState } from "react";
import { RenderBoundary } from "./RenderBoundary";

/** Keep navigation mounted while a heavy page loads. Recreate React.lazy on a
 * user retry: resetting an error boundary alone retains its rejected promise.
 */
function deferredPage<P extends object>(load: () => Promise<{ default: React.ComponentType<P> }>) {
  return function DeferredPage(props: P) {
    const [attempt, setAttempt] = useState(0);
    const Page = useMemo(() => { void attempt; return lazy(load); }, [attempt]);
    return <RenderBoundary scope="page" resetKey={String(attempt)} onRetry={() => setAttempt((value) => value + 1)}>
      <Suspense fallback={<section className="workspace-empty" role="status">正在打开页面…</section>}><Page {...props} /></Suspense>
    </RenderBoundary>;
  };
}

type DeviceDetailsProps = NonNullable<Parameters<typeof import("./pages/DeviceDetailsPage").DeviceDetailsPage>[0]>;
type SettingsProps = NonNullable<Parameters<typeof import("./pages/SettingsPage").SettingsPage>[0]>;
export const LazyDeviceDetailsPage = deferredPage<DeviceDetailsProps>(() => import(/* webpackChunkName: "guanlan-device" */ "./pages/DeviceDetailsPage").then((module) => ({ default: module.DeviceDetailsPage })));
export const LazySettingsPage = deferredPage<SettingsProps>(() => import(/* webpackChunkName: "guanlan-settings" */ "./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
