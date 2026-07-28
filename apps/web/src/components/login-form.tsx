"use client";

import React, { useState } from "react";
import { ApiError, getSession, login } from "../lib/api";
import styles from "./monitor.module.css";

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
      <div className={`${styles.doubleBezelShell} ${styles.loginCardShell}`}>
        <form className={`${styles.doubleBezelInner} ${styles.loginCardInner}`} onSubmit={handleSubmit}>
          <div className={styles.loginHeader}>
            <div className={styles.brandLogo} style={{ width: "48px", height: "48px", fontSize: "18px" }}>
              DSC
            </div>
            <div className={styles.eyebrowTag} style={{ marginTop: "12px" }}>
              <span>🔐</span>
              <span>SaaS 安全中枢控制台</span>
            </div>
            <h1 style={{ fontSize: "24px", fontWeight: 800, margin: "4px 0 0", color: "var(--text-primary)" }}>
              登录设备中枢系统
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
              请输入授权 AccessKey 以解锁全网节点监控与图表看板
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)" }}>
              访问密钥 (Access Key)
            </label>
            <input
              type="password"
              className={styles.loginInput}
              placeholder="••••••••••••••••"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <div className={styles.errorMessage}>{error}</div>}

          <button
            type="submit"
            className={styles.pillButton}
            disabled={pending}
            style={{ width: "100%", justifyContent: "center", padding: "12px" }}
          >
            <span>{pending ? "正在验证密钥..." : "解锁进入控制台"}</span>
            <span className={styles.buttonIconCircle}>→</span>
          </button>
        </form>
      </div>
    </main>
  );
}
