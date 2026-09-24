"use client";

import React, { useState } from "react";
import { M3Button, M3TextField } from "@dsc/console-ui";
import { ApiError, getSession, login } from "../lib/api";
import styles from "./auth.module.css";

export function LoginForm({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    let phase: "login" | "session" | "snapshot" = "login";
    try {
      await login({ accessKey });
      phase = "session";
      await getSession();
      phase = "snapshot";
      await onAuthenticated();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setError(phase === "snapshot" ? "认证已通过，但设备快照仍拒绝访问；请重新登录或联系中枢管理员。" : "访问密钥错误，请校验后重试。");
      } else if (error instanceof TypeError) {
        setError("无法连接中枢，请检查网络或站点地址后重试。");
      } else if (phase === "snapshot") {
        setError("登录成功，但设备快照读取失败；请稍后刷新重试。");
      } else {
        setError("登录请求失败，请稍后重试。");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.loginShell}>
      <header className={styles.loginTop}>
        <div className={styles.loginBrand}>
          <img src="/logo.png" alt="观澜" className={styles.brandLogoImage} />
          <div><strong>观澜</strong><span>设备状态中枢</span></div>
        </div>
        <span className={styles.loginTopNote}>浏览器工作台</span>
      </header>
      <section className={styles.loginPanel} aria-label="登录观澜中枢">
        <div className={styles.loginFormShell}>
          <form onSubmit={handleSubmit}>
            <div className={styles.loginHeader}>
              <p className={styles.loginPanelEyebrow}>登录</p>
              <h1>进入设备状态中枢</h1>
              <p>使用访问密钥查看当前站点授权的设备与指标。</p>
            </div>

            <M3TextField
              className={styles.loginField}
              id="access-key"
              label="访问密钥"
              type="password"
              placeholder="输入访问密钥"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              autoComplete="current-password"
              errorText={error ?? undefined}
              supportingText={error ? undefined : "密钥只用于当前浏览器会话认证。"}
              required
            />

            <M3Button type="submit" className={styles.loginSubmit} disabled={pending} variant="filled">
              {pending ? "正在验证密钥…" : "登录"}
            </M3Button>
          </form>
          <p className={styles.loginSecurityNote}>登录请求通过当前站点发送。访问密钥只用于当前浏览器会话，不会写入 URL 或本地存储。</p>
        </div>
      </section>
    </main>
  );
}
