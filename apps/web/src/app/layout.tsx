import type { Metadata } from "next";
import "./globals.css";
import "@dsc/console-ui/styles.css";

export const metadata: Metadata = {
  title: "DSC Hub - 设备状态集中控制台",
  description: "企业级 SaaS 设备状态监控系统，全域节点状态实时感知与硬件监控",
  icons: {
    icon: "/favicon.png",
    apple: "/logo.png"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
