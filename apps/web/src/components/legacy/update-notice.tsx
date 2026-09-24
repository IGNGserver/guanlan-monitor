"use client";

import { useEffect, useState } from "react";
import type { UpdateInfo } from "@dsc/shared";
import { getHubUpdateStatus, getSystemVersionInfo, getUpdateInfo, requestHubUpdate } from "../../lib/api";
import styles from "./monitor.module.css";

type UpdatePhase = "checking" | "ready" | "requesting" | "requested" | "completed" | "failed";

export function UpdateNotice() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [phase, setPhase] = useState<UpdatePhase>("checking");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void getUpdateInfo("hub")
      .then((result) => {
        if (!active) return;
        setUpdate(result);
        setPhase(result.available ? "ready" : "checking");
      })
      .catch(() => {
        if (active) setPhase("checking");
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleUpdate() {
    if (!update?.latestVersion) return;
    setPhase("requesting");
    setMessage("");
    try {
      const result = await requestHubUpdate(update.latestVersion);
      setPhase(result.state === "requested" ? "requested" : "failed");
      setMessage(result.message ?? "");
    } catch {
      setPhase("failed");
      setMessage("当前 Hub 未开启自动部署，请联系管理员或使用固定版本部署流程。");
    }
  }

  useEffect(() => {
    if (phase !== "requested") return;
    const timer = window.setInterval(() => {
      void Promise.all([getHubUpdateStatus(), getSystemVersionInfo()])
        .then(([result, system]) => {
          if (result.state === "failed") {
            setPhase("failed");
            setMessage(result.message ?? "Hub 更新失败");
            return;
          }
          if (update?.latestVersion && system.version === update.latestVersion) {
            setPhase("completed");
            setMessage("Hub 已更新完成，正在刷新页面。");
            window.setTimeout(() => window.location.reload(), 1500);
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [phase, update?.latestVersion]);

  if (!update?.available || !update.latestVersion) return null;

  return (
    <section className={styles.updateNotice} aria-live="polite">
      <div>
        <strong>发现 Hub 更新 v{update.latestVersion}</strong>
        <span>
          {phase === "requested"
            ? " 已提交部署任务，页面会在服务重启后自动恢复。"
            : phase === "completed"
              ? ` ${message}`
              : phase === "failed"
                ? ` ${message}`
                : " 点击后由受保护的部署工作流完成更新。"}
        </span>
      </div>
      <div className={styles.updateNoticeActions}>
        {(phase === "requesting" || phase === "requested") && (
          <progress className={styles.updateProgress} />
        )}
        {phase !== "requested" && phase !== "completed" && (
          <button
            type="button"
            className={styles.footerActionBtn}
            onClick={() => void handleUpdate()}
            disabled={phase === "requesting"}
          >
            {phase === "requesting" ? "提交中…" : "更新 Hub"}
          </button>
        )}
        {update.releaseUrl && (
          <a className={styles.updateReleaseLink} href={update.releaseUrl} target="_blank" rel="noreferrer">
            查看说明
          </a>
        )}
      </div>
    </section>
  );
}
