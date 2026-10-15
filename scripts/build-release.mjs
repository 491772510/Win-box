// Release-only build（本仓扩展：目标平台开关 / 原生桥前置校验 / LICENSE 兜底）。
//
// ★ 2026-10-15（合并上游 1.21.5）：上游把「赞赏图 / 加群二维码」功能**整条删除**
//   （src/build/supportImage.ts、vite 别名、关于页弹窗），本仓随之移除
//   `--allow-placeholder` 与「产物里含原图」的 SHA256 校验。
//   副作用（好的那种）：现在打包**不再需要任何私有素材**，从零 clone 的仓库可直接出包。
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ★ 2026-10-12（macOS 适配 · T04）：目标平台开关。
//   --mac  → electron-builder `--mac dmg zip`（产出 arm64 + x64 的 dmg 与 zip）
//   --win  → 与原脚本完全一致的 `--win nsis`
//   无参数  → 默认 Windows（★ 零回归红线：默认分支的行为一字不改）
const argv = process.argv.slice(2).filter(a => a !== '--');
const unknown = argv.filter(a => !['--mac', '--win', '--dry-run', '--allow-no-bridge'].includes(a));
if (unknown.length) {
  console.error(`Unknown argument(s): ${unknown.join(' ')}`);
  console.error('Usage: node scripts/build-release.mjs [--win | --mac] [--dry-run] [--allow-no-bridge]');
  process.exit(1);
}
const target = argv.includes('--mac') ? 'mac' : 'win';
const dryRun = argv.includes('--dry-run');
const builderArgs = target === 'mac'
  ? ['--mac', 'dmg', 'zip', '--publish', 'never']
  : ['--win', 'nsis', '--publish', 'never'];

const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(['scripts/build-main.mjs']);
run(['node_modules/vite/bin/vite.js', 'build']);

// ★ 2026-10-14：原生桥 jar 必须随包 —— 缺了它，**所有含 .so 的加固壳源**在桌面上只能报
//   「该源依赖安卓原生库（.so），桌面版无法加载（架构限制，非移植缺陷）」（见 JarSpiderBridge
//   的 translateSpiderLog）。而这只 jar 曾经不入库，加上唯一的构建脚本 build.ps1 是 PowerShell，
//   mac 上从零 clone 的仓库里就根本没有它 —— 这是 mac 适配里最隐蔽的一处缺口。
//
// ★ 2026-10-15：把关从「只挂 mac 分支」提为**平台无关**。
//   原先只查 mac 的理由是「Windows 主开发机历史上一直有它（本地构建产物）」——
//   但自 c2ca033 起这只 jar 已随源码入库，那个理由不再成立；而 Windows 分支一旦本地误删
//   就会**静默**打出一个「无原生桥」的包，用户拿到后所有加固壳源全废且毫无提示。
//   现在两个平台都强制校验；确需出降级包时用 --allow-no-bridge 显式放行（行为对 mac 不变）。
if (!argv.includes('--allow-no-bridge')) {
  const bridge = join(root, 'resources/jvm/native-bridge/native-bridge.jar');
  if (!existsSync(bridge)) {
    console.error(`缺少 resources/jvm/native-bridge/native-bridge.jar —— 缺了它，含 .so 的加固壳源在桌面端全部不可用（报「依赖安卓原生库」）。`);
    console.error(`  · 打包目标：${target}`);
    console.error('  · 正常情况下该 jar 已随源码入库，先 git status 确认是不是被误删；');
    console.error('  · 需要重建时：node resources/jvm/native-bridge/build-native-bridge.mjs（或 pnpm build:native-bridge）');
    console.error('  · 确实要出「无原生桥」的降级包：加 --allow-no-bridge');
    process.exit(1);
  }
  console.log(`native bridge verified: ${bridge}`);
} else {
  console.warn('⚠ --allow-no-bridge：跳过原生桥校验，本包内所有含 .so 的加固壳源将不可用。');
}

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
//   （正式发布机上放作者自己的协议文本，不入库）。
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
