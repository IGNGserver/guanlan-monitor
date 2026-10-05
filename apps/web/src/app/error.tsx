"use client";

import { useEffect } from "react";
import { M3Button } from "@dsc/console-ui";
import styles from "../components/auth.module.css";

/**
 * Route-level fallback. The workspace contains its own failures per page and per
 * chart; this catches what sits outside it (the session gate, the login form)
 * so a render exception there shows a way back instead of a blank document.
 */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[guanlan] route render failed", error);
  }, [error]);
  return (
    <main className={styles.loginShell}>
      <header className={styles.loginTop}>
        <div className={styles.loginBrand}>
          <img src="/logo.png" alt="观澜" className={styles.brandLogoImage} />
          <div><strong>观澜</strong><span>设备状态中枢</span></div>
        </div>
      </header>
      <section className={styles.loginPanel} role="alert">
        <div className={styles.loginFormShell}>
          <h1>页面显示出错</h1>
          <p>页面在渲染时遇到问题。重试通常可以恢复；如果反复出现，请刷新浏览器。</p>
          <M3Button onClick={reset}>重试</M3Button>
        </div>
      </section>
    </main>
  );
}
