// Upload installers only to an existing Release. Never include blockmap/build metadata.
// By default use the local HTTPS proxy commonly configured by Clash/Mihomo on Windows.
// Override with GH_UPLOAD_PROXY, or set it to an empty string for direct access.
// Usage: pnpm run release:upload [-- --dry-run]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const proxyReachable = (proxyUrl) => new Promise((resolve) => {
  try {
    const url = new URL(proxyUrl);
    const socket = createConnection({ host: url.hostname, port: Number(url.port || 80) });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(800, () => done(false));
  } catch {
    resolve(false);
  }
});
const args = process.argv.slice(2).filter(a => a !== '--');
if (args.some(a => a !== '--dry-run')) {
  console.error('Usage: node scripts/upload-release.mjs [--dry-run]');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `release${pkg.version}`;
// ★ 2026-10-17（本仓 fork）：发布目标默认从 origin 解析 —— 上游原值是硬编码的
//   'yagami-hue/Win-box'，本仓若照抄会把安装包往原作者仓库推（必然 403，且是误操作）。
//   优先级：WINBOX_RELEASE_REPO 环境变量 > git remote origin > 上游默认值。
const repo = process.env.WINBOX_RELEASE_REPO
  || /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(
    spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).stdout?.trim() || '',
  )?.[1]
  || 'yagami-hue/Win-box';
const output = resolve(root, pkg.build.directories.output);
// electron-builder normalizes numeric version components when it creates the
// artifact name (for example, package version 1.21.01 becomes 1.21.1).
const artifactVersions = [...new Set([
  pkg.version,
  String(pkg.version).split('.').map(part => /^\d+$/.test(part) ? String(Number(part)) : part).join('.'),
])];
// ★ 2026-10-12（macOS 适配 · T04）：Windows 的 Setup / 便携两种命名一字不改，
//   额外并列支持 macOS 的 dmg（架构命名 Win-Box-<version>-arm64.dmg / -x64.dmg）。
// ★ 2026-10-13（合并上游）：dmg 同样按归一后的版本号匹配（1.21.01 → 1.21.1）。
const winInstallers = new Set(artifactVersions.flatMap(version => [
  `Win-Box Setup ${version}.exe`,
  `Win-Box ${version}.exe`,
]));
const macInstallers = new Set(artifactVersions.flatMap(version => [
  `Win-Box-${version}-arm64.dmg`,
  `Win-Box-${version}-x64.dmg`,
  `Win-Box-${version}.dmg`,
]));
const assets = readdirSync(output, { withFileTypes: true })
  .filter(e => {
    if (!e.isFile()) return false;
    const lower = e.name.toLowerCase();
    if (lower.endsWith('.exe')) return winInstallers.has(e.name);
    if (lower.endsWith('.dmg')) return macInstallers.has(e.name);
    return false;
  })
  .map(e => ({ path: join(output, e.name), mac: e.name.toLowerCase().endsWith('.dmg') }));
if (!assets.length) {
  console.error(`No installers for ${pkg.version} found in ${output}`);
  console.error(`Expected: "Win-Box Setup ${pkg.version}.exe" / "Win-Box ${pkg.version}.exe" (win32)`);
  console.error(`      or: "Win-Box-${pkg.version}-arm64.dmg" / "Win-Box-${pkg.version}-x64.dmg" (darwin)`);
  process.exit(1);
}
console.log(`Release: ${repo} / ${tag}`);
// ★ 平台写在括号里 —— 「Installer:」字面量是 tests/releaseUpload.spec.ts 的断言锚点，勿改。
for (const asset of assets) console.log(`Installer: ${asset.path} (${asset.mac ? 'darwin' : 'win32'})`);
if (args.includes('--dry-run')) {
  console.log('Dry run: no files uploaded. Only .exe / .dmg installers are selected.');
} else {
  const requestedProxy = process.env.GH_UPLOAD_PROXY;
  let proxy = requestedProxy === 'direct' || requestedProxy === 'none'
    ? ''
    : requestedProxy === undefined ? 'http://127.0.0.1:7897' : requestedProxy;
  if (process.env.GH_UPLOAD_PROXY === undefined && !(await proxyReachable(proxy))) {
    proxy = '';
    console.log('Local upload proxy 127.0.0.1:7897 is unavailable; falling back to direct access.');
  }
  const env = { ...process.env };
  if (proxy) {
    env.HTTPS_PROXY = proxy;
    env.HTTP_PROXY = proxy;
    console.log(`GitHub upload route: ${proxy}`);
  } else {
    delete env.HTTPS_PROXY;
    delete env.HTTP_PROXY;
    console.log('GitHub upload route: direct');
  }
  const run = commandArgs => {
    const result = spawnSync('gh', commandArgs, { cwd: root, env, stdio: 'inherit', shell: false });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
  // Does not create a Release, replace existing assets, or edit release notes.
  run(['release', 'view', tag, '--repo', repo]);
  run(['release', 'upload', tag, ...assets.map(a => a.path), '--repo', repo]);
}
