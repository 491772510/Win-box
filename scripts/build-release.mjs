// Release-only build: refuse to package source placeholder artwork
// （例外：显式加 `--allow-placeholder` 时允许用占位图出自用包，见文件内注释）。
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ★ 2026-10-12（macOS 适配 · T04）：目标平台开关。
//   --mac  → electron-builder `--mac dmg zip`（产出 arm64 + x64 的 dmg 与 zip）
//   --win  → 与原脚本完全一致的 `--win nsis`
//   无参数  → 默认 Windows（★ 零回归红线：默认分支的行为一字不改）
const argv = process.argv.slice(2).filter(a => a !== '--');
const unknown = argv.filter(a => !['--mac', '--win', '--dry-run', '--allow-placeholder'].includes(a));
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}`);
  console.error('Usage: node scripts/build-release.mjs [--win | --mac] [--dry-run] [--allow-placeholder]');
  process.exit(1);
}
// ★ 2026-10-13（用户要求）：本机没有私有原图（赞助码 / 加群二维码）时，允许用仓库自带的
//   占位图先出一个**可自用**的安装包。默认仍严格拒绝 —— 对外发布时必须带原图。
const allowPlaceholder = argv.includes('--allow-placeholder');
const target = argv.includes('--mac') ? 'mac' : 'win';
const dryRun = argv.includes('--dry-run');
const builderArgs = target === 'mac'
  ? ['--mac', 'dmg', 'zip', '--publish', 'never']
  : ['--win', 'nsis', '--publish', 'never'];
const PLACEHOLDERS = {
  support: 'src/renderer/assets/author-support-placeholder.svg',
  group: 'src/renderer/assets/group-join-placeholder.svg',
};

/**
 * 选图：环境变量 → 仓库候选 →（仅 --allow-placeholder）占位图 → 否则报错。
 * 返回 `{ path, isPlaceholder }`，供后面决定要不要做「产物里含原图」的哈希校验。
 */
function pickImage(envVar, candidates, placeholder, label) {
  if (process.env[envVar]) return { path: resolve(root, process.env[envVar]), isPlaceholder: false };
  const hit = candidates.map(file => join(root, file)).find(existsSync);
  if (hit) return { path: hit, isPlaceholder: false };
  if (!allowPlaceholder) {
    throw new Error(`${label} missing. Set ${envVar} to the original artwork before releasing（自用包可加 --allow-placeholder 用占位图）。`);
  }
  const ph = join(root, placeholder);
  if (!existsSync(ph)) throw new Error(`${label} missing and placeholder not found: ${ph}`);
  console.warn(`\n⚠⚠ ${label} 用占位图打包 —— 关于页会显示占位图，此包仅供自用，不要对外发布。\n`);
  return { path: ph, isPlaceholder: true };
}

const support = pickImage(
  'WINBOX_SUPPORT_IMAGE',
  ['src/renderer/assets/author-support.png', '.tmp/private-assets/author-support.png'],
  PLACEHOLDERS.support,
  'Private support PNG',
);
const group = pickImage(
  'WINBOX_GROUP_IMAGE',
  ['src/renderer/assets/group-join.jpg', '.tmp/private-assets/group-join.jpg', 'src/renderer/assets/group-join.png', '.tmp/private-assets/group-join.png'],
  PLACEHOLDERS.group,
  'Private group QR image',
);
const image = support.path;
const groupImage = group.path;
const env = {
  ...process.env,
  WINBOX_SUPPORT_IMAGE: image,
  WINBOX_GROUP_IMAGE: groupImage,
  WINBOX_RELEASE_BUILD: '1',
  // vite.config.ts 用它放开「release 必须原图」的校验（仅 --allow-placeholder 时置位）
  ...(allowPlaceholder ? { WINBOX_ALLOW_PLACEHOLDER_ART: '1' } : {}),
};
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(['scripts/build-main.mjs']);
run(['node_modules/vite/bin/vite.js', 'build']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = join(root, 'dist/renderer/assets');

/**
 * 校验「构建产物里确实是那张图」。占位图模式下跳过：占位 SVG 只有 151 字节，
 * 低于 vite 的 assetsInlineLimit（4KB），会被内联成 data URL 而不落成独立文件，
 * 按文件哈希去比对必然查不到。
 */
function verifyPackaged(pick, label) {
  if (pick.isPlaceholder) {
    console.warn(`⚠ ${label}：占位图已内联进产物，跳过原图哈希校验（此包仅供自用）。`);
    return;
  }
  const original = hash(readFileSync(pick.path));
  const packaged = readdirSync(assets)
    .find(name => /\.(png|jpe?g)$/i.test(name) && hash(readFileSync(join(assets, name))) === original);
  if (!packaged) throw new Error(`Built renderer does not contain the original ${label}. Packaging stopped.`);
  console.log(`${label} verified: ${packaged} / SHA256 ${original}`);
}
verifyPackaged(support, 'Support artwork');
verifyPackaged(group, 'Group QR artwork');

// macOS 前置检查：electron-builder 需要 build/icon.icns（icns 不入库，需先在 Mac 上生成）。
// 只影响 --mac 分支；Windows 分支不读这个文件，行为不变。
if (target === 'mac') {
  const icns = join(root, 'build/icon.icns');
  if (!existsSync(icns)) {
    console.error('Missing build/icon.icns — 先在 macOS 上执行：`node scripts/make-icon.mjs`（用系统自带 sips + iconutil 从 build/icon.png 生成）。');
    process.exit(1);
  }
  console.log(`macOS icon verified: ${icns}`);
}

// ★ 2026-10-13：`build.nsis.license` 指向 `LICENSE.txt`，而该文件被 .gitignore 主动排除
//   （与赞助码/加群二维码同一套路：正式发布机上放作者自己的协议文本，不入库）。
//   本机没有它 → NSIS 直接报 "cannot find specified resource LICENSE.txt" 而打包失败。
//   缺文件时退回仓库里已提交的 MIT `LICENSE`（复制到同样被忽略的 LICENSE.txt，不污染版本库）。
const licenseTxt = join(root, 'LICENSE.txt');
if (!existsSync(licenseTxt)) {
  const trackedLicense = join(root, 'LICENSE');
  if (!existsSync(trackedLicense)) {
    console.error('Missing LICENSE.txt（且仓库里也没有 LICENSE 可兜底）—— 请先准备协议文本再打包。');
    process.exit(1);
  }
  copyFileSync(trackedLicense, licenseTxt);
  console.warn(`⚠ 未找到 LICENSE.txt，已用仓库的 LICENSE（MIT）顶上；安装协议页会显示 MIT 文本。`);
}

const builderCmd = ['node_modules/electron-builder/out/cli/cli.js', ...builderArgs];
console.log(`electron-builder args: ${builderArgs.join(' ')}`);
if (dryRun) {
  console.log('Dry run: 不执行打包，仅打印将要执行的命令与前置校验结果。');
  process.exit(0);
}
run(builderCmd);
