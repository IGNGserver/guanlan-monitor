export const WINDOW_LABELS = {
  "1m": "1 分钟",
  "15m": "15 分钟",
  "1d": "1 天",
  "1w": "1 周",
  "1mo": "1 月",
  "1y": "1 年"
} as const;

export const WINDOW_BUCKETS = {
  "1m": 5,
  "15m": 60,
  "1d": 3600,
  "1w": 86400,
  "1mo": 86400,
  "1y": 86400
} as const;
