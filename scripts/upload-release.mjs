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
const repo = 'yagami-hue/Win-box';
const output = resolve(root, pkg.build.directories.output);
// ★ 2026-10-12（macOS 适配 · T04）：Windows 分支的筛选条件一字不改，
//   额外并列支持 macOS 的 dmg（架构命名 Win-Box-<version>-arm64.dmg / -x64.dmg）。
const winInstaller = name => name === `Win-Box Setup ${pkg.version}.exe` || name === `Win-Box ${pkg.version}.exe`;
const macInstaller = name =>
  name === `Win-Box-${pkg.version}-arm64.dmg` ||
  name === `Win-Box-${pkg.version}-x64.dmg` ||
  name === `Win-Box-${pkg.version}.dmg`;
const assets = readdirSync(output, { withFileTypes: true })
  .filter(e => {
    if (!e.isFile()) return false;
    const lower = e.name.toLowerCase();
    if (lower.endsWith('.exe')) return winInstaller(e.name);
    if (lower.endsWith('.dmg')) return macInstaller(e.name);
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
for (const asset of assets) console.log(`Installer(${asset.mac ? 'darwin' : 'win32'}): ${asset.path}`);
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
