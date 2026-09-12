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
    try {
      await login({ accessKey });
      await getSession();
      await onAuthenticated();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setError("访问密钥错误，请校验后重试");
      } else {
        setError("登录已提交，但页面状态同步失败。请重试一次。");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.loginShell}>
      <section className={styles.loginAside} aria-label="观澜中枢介绍">
        <div className={styles.loginBrand}>
          <img src="/logo.png" alt="观澜" className={styles.brandLogoImage} />
          <span>观澜</span>
          <small>WEB HUB</small>
        </div>
        <div className={styles.loginAsideContent}>
          <p className={styles.loginEyebrow}>浏览器端中枢</p>
          <h1>从一个中枢，看见全部节点。</h1>
          <p>通过浏览器访问接入中枢，查看设备、虚拟机和硬件指标的实时状态。</p>
        </div>
        <div className={styles.loginSignals} aria-label="网页端能力">
          <div className={styles.loginSignal}><span>运行模式</span><strong>浏览器工作台</strong></div>
          <div className={styles.loginSignal}><span>数据通道</span><strong>中枢实时同步</strong></div>
          <div className={styles.loginSignal}><span>访问范围</span><strong>已授权节点</strong></div>
        </div>
        <div className={styles.loginAsideFooter}><span className={styles.loginLiveIndicator} aria-hidden="true" />安全会话由中枢验证</div>
      </section>

      <section className={styles.loginPanel} aria-label="登录观澜中枢">
        <div className={styles.loginFormShell}>
          <div className={styles.loginPanelTop}><span>欢迎回来</span><span>ACCESS / SESSION</span></div>
          <form onSubmit={handleSubmit}>
            <div className={styles.loginHeader}>
              <p className={styles.loginPanelEyebrow}>登录设备中枢</p>
              <h1>进入中枢工作台</h1>
              <p>使用中枢访问密钥登录浏览器控制台。</p>
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
              {pending ? "正在验证密钥..." : "进入中枢"}
            </M3Button>
          </form>
          <p className={styles.loginSecurityNote}><span aria-hidden="true">TLS</span>登录请求通过当前站点发送。请不要在公共设备上保存访问密钥。</p>
        </div>
      </section>
    </main>
  );
}
