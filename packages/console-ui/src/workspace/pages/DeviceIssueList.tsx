import React from "react";
import { describeIssue, type DeviceIssue } from "../health";
import { formatDate } from "../formatters";
import { Icon } from "../ui";

/**
 * The fleet's open issues, most urgent first.
 *
 * One row per issue rather than one card per device: "which machine, which
 * resource, how far past which line" is the whole answer, and a device with two
 * problems should show both. Severity is carried by an icon and a word as well
 * as colour.
 */
export function DeviceIssueList({ issues, onOpen, limit = 8 }: { issues: readonly DeviceIssue[]; onOpen: (deviceId: string) => void; limit?: number }) {
  const shown = issues.slice(0, limit);
  const hidden = issues.length - shown.length;
  return (
    <div className="workspace-issues">
      <ul className="workspace-issue-list" aria-label="需要关注的问题">
        {shown.map((issue) => (
          <li key={`${issue.deviceId}:${issue.kind}`}>
            <button type="button" className={`workspace-issue workspace-issue--${issue.severity}`} onClick={() => onOpen(issue.deviceId)}>
              <span className="workspace-issue__icon" aria-hidden="true"><Icon name="warning" size={18} /></span>
              <span className="workspace-issue__copy">
                <strong>{issue.hostname}</strong>
                <span>{describeIssue(issue, formatDate)}</span>
              </span>
              <span className="workspace-issue__severity">{issue.severity === "critical" ? "严重" : "警告"}</span>
              <span className="workspace-issue__chevron" aria-hidden="true"><Icon name="chevronRight" size={18} /></span>
            </button>
          </li>
        ))}
      </ul>
      {hidden > 0 ? <p className="workspace-issues__more">另有 {hidden} 项问题，到“设备”页按状态筛选查看。</p> : null}
    </div>
  );
}
