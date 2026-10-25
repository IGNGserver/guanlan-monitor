import type { Metadata } from "next";
import "./globals.css";
const iconPath = (name: string) => `/icons/${process.env.NEXT_PUBLIC_DSC_ICON_VERSION}/${name}.png`;
import "@dsc/console-ui/styles.scss";

export const metadata: Metadata = {
  title: "观澜 / Guanlan · 设备状态工作区",
  description: "面向硬件监控与可观测性的设备状态工作区",
  manifest: "/manifest.webmanifest",
  other: { "guanlan-pwa-revision": process.env.NEXT_PUBLIC_DSC_PWA_REVISION ?? "development" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "观澜"
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: iconPath("icon-192"), type: "image/png", sizes: "192x192" },
      { url: iconPath("icon-512"), type: "image/png", sizes: "512x512" },
      { url: iconPath("icon-1024"), type: "image/png", sizes: "1024x1024" }
    ],
    apple: [
      { url: iconPath("apple-touch-icon-180"), sizes: "180x180", type: "image/png" },
      { url: iconPath("apple-touch-icon-167"), sizes: "167x167", type: "image/png" },
      { url: iconPath("apple-touch-icon-152"), sizes: "152x152", type: "image/png" }
    ]
  }
};

export const viewport = {
  themeColor: "#3d638f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
