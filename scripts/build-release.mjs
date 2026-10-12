// Release-only build: refuse to package source placeholder artwork.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
const unknown = argv.filter(a => a !== '--mac' && a !== '--win' && a !== '--dry-run');
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}`);
  console.error('Usage: node scripts/build-release.mjs [--win | --mac] [--dry-run]');
  process.exit(1);
}
const target = argv.includes('--mac') ? 'mac' : 'win';
const dryRun = argv.includes('--dry-run');
const builderArgs = target === 'mac'
  ? ['--mac', 'dmg', 'zip', '--publish', 'never']
  : ['--win', 'nsis', '--publish', 'never'];
const image = process.env.WINBOX_SUPPORT_IMAGE
  ? resolve(root, process.env.WINBOX_SUPPORT_IMAGE)
  : ['src/renderer/assets/author-support.png', '.tmp/private-assets/author-support.png']
    .map(file => join(root, file)).find(existsSync);
if (!image) throw new Error('Private support PNG missing. Set WINBOX_SUPPORT_IMAGE to the original artwork before releasing.');
const groupImage = process.env.WINBOX_GROUP_IMAGE
  ? resolve(root, process.env.WINBOX_GROUP_IMAGE)
  : ['src/renderer/assets/group-join.jpg', '.tmp/private-assets/group-join.jpg', 'src/renderer/assets/group-join.png', '.tmp/private-assets/group-join.png']
    .map(file => join(root, file)).find(existsSync);
if (!groupImage) throw new Error('Private group QR image missing. Set WINBOX_GROUP_IMAGE to the original artwork before releasing.');
const env = { ...process.env, WINBOX_SUPPORT_IMAGE: image, WINBOX_GROUP_IMAGE: groupImage, WINBOX_RELEASE_BUILD: '1' };
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(['scripts/build-main.mjs']);
run(['node_modules/vite/bin/vite.js', 'build']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = hash(readFileSync(image));
const groupOriginal = hash(readFileSync(groupImage));
const assets = join(root, 'dist/renderer/assets');
const packagedImage = readdirSync(assets).find(name => /\.(png|jpe?g)$/i.test(name) && hash(readFileSync(join(assets, name))) === original);
if (!packagedImage) throw new Error('Built renderer does not contain the original support image. Packaging stopped.');
const packagedGroupImage = readdirSync(assets).find(name => /\.(png|jpe?g)$/i.test(name) && hash(readFileSync(join(assets, name))) === groupOriginal);
if (!packagedGroupImage) throw new Error('Built renderer does not contain the original group QR image. Packaging stopped.');
console.log(`Support artwork verified: ${packagedImage} / SHA256 ${original}`);
console.log(`Group QR artwork verified: ${packagedGroupImage} / SHA256 ${groupOriginal}`);

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

const builderCmd = ['node_modules/electron-builder/out/cli/cli.js', ...builderArgs];
console.log(`electron-builder args: ${builderArgs.join(' ')}`);
if (dryRun) {
  console.log('Dry run: 不执行打包，仅打印将要执行的命令与前置校验结果。');
  process.exit(0);
}
run(builderCmd);
