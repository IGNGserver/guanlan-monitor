// @ts-check
import { defineConfig } from 'astro/config';

// 正式域名 https://guanlan.igng.net/（见 docs/HOSTING.md），用作 canonical 与 og:image 的绝对地址。
// SITE_URL 仅在预览或迁移验证时覆盖；缺省值必须是正式域名，否则部署到新域名时 SEO 标签会退化。
const site = process.env.SITE_URL || 'https://guanlan.igng.net/';

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  vite: {
    build: { assetsInlineLimit: 2048 },
  },
});
