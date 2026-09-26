"use client";

import React, { useState } from "react";
import { M3Button, M3TextField } from "@dsc/console-ui";
import { ApiError, getSession, login } from "../lib/api";
import styles from "./auth.module.css";

export function LoginForm({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [accessKey, setAccessKey] = useState("");
  const [revealKey, setRevealKey] = useState(false);
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
        setError(phase === "snapshot" ? "认证已通过，但设备快照仍拒绝访问。请重新登录，或联系中枢管理员确认这台设备的授权。" : "访问密钥不正确。请核对后重新输入。");
      } else if (error instanceof TypeError) {
        setError("无法连接到中枢。请检查网络或本站点地址后重试。");
      } else if (phase === "snapshot") {
        setError("登录成功，但设备快照读取失败。请稍后刷新重试。");
      } else {
        setError("登录请求未被接受。请稍后重试；若持续失败，请查看页面底部的帮助与反馈。");
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
              type={revealKey ? "text" : "password"}
              placeholder="输入访问密钥"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              autoComplete="current-password"
              errorText={error ?? undefined}
              supportingText={error ? undefined : "密钥只用于当前浏览器会话认证。"}
              required
            />

            <button
              className={styles.loginReveal}
              type="button"
              onClick={() => setRevealKey((current) => !current)}
            >
              {revealKey ? "隐藏密钥" : "显示密钥"}
            </button>

            <M3Button type="submit" className={styles.loginSubmit} disabled={pending} variant="filled">
              {pending ? "正在验证密钥…" : "登录"}
            </M3Button>
          </form>

          {/* The single question that stopped first-time users: where does this
              key come from? It is not the user's device password, and nothing on
              this page used to say so. */}
          <div className={styles.loginHelp}>
            <h2>还没有访问密钥？</h2>
            <p>访问密钥由<strong>中枢</strong>（部署观澜服务的那台机器）的管理员设置，不是任何设备的登录密码。中枢部署时会生成一次，可在中枢的 <code>ACCESS_KEY</code> 环境变量或部署配置中查看。</p>
            <p>拿到密钥后回到这里输入即可；设备由各自的 Agent 自动上报，不需要在这个页面添加。</p>
            <a className={styles.loginHelpLink} href="https://github.com/IGNGserver/guanlan-monitor#readme" target="_blank" rel="noreferrer">查看中枢部署与 Agent 安装说明</a>
          </div>

          <p className={styles.loginSecurityNote}>登录请求通过当前站点发送。访问密钥只用于当前浏览器会话，不会写入 URL 或本地存储。</p>
        </div>
      </section>
    </main>
  );
}
