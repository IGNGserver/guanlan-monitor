"use client";

import { useState } from "react";
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
        setError("访问密钥错误");
      } else {
        setError("登录已提交，但页面状态同步失败。请重试一次。");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.loginShell}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div>
          <p className={styles.eyebrow}>设备状态控制台</p>
          <h1>登录中枢系统</h1>
          <p className={styles.subtle}>未登录前不可查看设备和历史数据。</p>
        </div>
        <label className={styles.field}>
          <span>访问密钥</span>
          <input
            type="password"
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error ? <p className={styles.errorText}>{error}</p> : null}
        <button className={styles.primaryButton} disabled={pending} type="submit">
          {pending ? "登录中..." : "进入控制台"}
        </button>
      </form>
    </main>
  );
}
