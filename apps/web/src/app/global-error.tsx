"use client";

/**
 * Last-resort fallback when the root layout itself fails. It replaces the whole
 * document, so it cannot rely on the shared stylesheet having loaded.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-CN">
      <body style={{ display: "grid", minHeight: "100dvh", placeItems: "center", margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20 }}>观澜暂时无法显示</h1>
          <p style={{ lineHeight: 1.6 }}>页面在加载时遇到问题。请重试，或刷新浏览器。</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: "0 20px", font: "inherit" }}>重试</button>
        </main>
      </body>
    </html>
  );
}
