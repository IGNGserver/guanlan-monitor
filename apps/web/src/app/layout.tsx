import type { Metadata } from "next";
import "./globals.css";
import "@dsc/console-ui/styles.scss";

export const metadata: Metadata = {
  title: "观澜 / Guanlan · 设备状态工作区",
  description: "面向硬件监控与可观测性的设备状态工作区",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "观澜"
  },
  icons: {
    icon: "/favicon.png",
    apple: "/logo.png"
  }
};

export const viewport = {
  themeColor: "#3d638f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
