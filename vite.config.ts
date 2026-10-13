// vite.config.ts — 渲染进程（React + Vite），dev server + build
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGroupImage, resolveSupportImage } from './src/build/supportImage';

const root = dirname(fileURLToPath(import.meta.url));

// ★ 2026-10-13：`scripts/build-release.mjs --allow-placeholder` 会置位这个变量，
//   用来在「本机没有赞助码/加群二维码原图」时放行占位图，出一个自用安装包。
//   默认（未置位）行为与之前完全一致：release 构建遇到占位图照旧报错。
const allowPlaceholderArt = process.env.WINBOX_ALLOW_PLACEHOLDER_ART === '1';
const strictArtwork = process.env.WINBOX_RELEASE_BUILD === '1' && !allowPlaceholderArt;

export default defineConfig({
  root: resolve(root, 'src/renderer'),
  plugins: [react()],
  resolve: {
    alias: {
      // Clean source checkouts use the placeholder; local builds prefer private artwork.
      // Release builds fail instead of silently shipping the placeholder.
      '@author-support-image': resolveSupportImage(root, process.env.WINBOX_SUPPORT_IMAGE, strictArtwork),
      '@group-join-image': resolveGroupImage(root, process.env.WINBOX_GROUP_IMAGE, strictArtwork),
    },
  },
  base: './',
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome130',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
