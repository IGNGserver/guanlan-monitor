import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "设备状态控制台",
  description: "设备状态监控系统"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
