// scripts/make-icon.mjs —— 用 macOS 自带命令把 build/icon.png 转成 build/icon.icns。
//
// ★ 为什么不用 npm 包：icon-gen / png2icons 之类会新增依赖与 pnpm-lock 变更（本项目红线：零新增依赖）。
//   macOS 自带 `sips`（缩放 PNG）与 `iconutil`（iconset → icns），Xcode Command Line Tools 安装后即有。
//
// 用法（只能在 macOS 上跑）：
//   node scripts/make-icon.mjs                # 默认源 build/icon.png → 产物 build/icon.icns
//   node scripts/make-icon.mjs --src <png>    # 指定源图
//   node scripts/make-icon.mjs --out <icns>   # 指定产物
//   node scripts/make-icon.mjs --keep         # 保留中间产物 build/icon.iconset（默认已清理）
//
// 源图要求：正方形，越大越好（≥1024×1024 最佳；小于 1024 时由 sips 放大，清晰度会下降）。
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 解析命令行参数（--k v 或 --k=v；--keep 是开关） */
function parseArgs(argv) {
  const out = { src: '', out: '', keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep') { out.keep = true; continue; }
    if (a === '--src' || a === '--out') { out[a.slice(2)] = argv[++i] ?? ''; continue; }
    const m = /^--(src|out)=(.*)$/.exec(a);
    if (m) { out[m[1]] = m[2]; continue; }
    if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/make-icon.mjs [--src <png>] [--out <icns>] [--keep]');
      process.exit(0);
    }
    console.error(`Unknown argument: ${a}\nUsage: node scripts/make-icon.mjs [--src <png>] [--out <icns>] [--keep]`);
    process.exit(1);
  }
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const src = resolve(root, opts.src || 'build/icon.png');
const target = resolve(root, opts.out || 'build/icon.icns');
const iconset = join(dirname(target), 'icon.iconset');

/**
 * iconset 规格（Apple 官方要求的 10 档）：
 *   1x:    16 / 32 / 128 / 256 / 512
 *   @2x:   16→32 / 32→64 / 128→256 / 256→512 / 512→1024
 * iconutil 只认这套命名，文件名写错会报 "Failed to generate ICNS"。
 */
const ICONSET_FILES = [
  { name: 'icon_16x16.png', size: 16 },
  { name: 'icon_16x16@2x.png', size: 32 },
  { name: 'icon_32x32.png', size: 32 },
  { name: 'icon_32x32@2x.png', size: 64 },
  { name: 'icon_128x128.png', size: 128 },
  { name: 'icon_128x128@2x.png', size: 256 },
  { name: 'icon_256x256.png', size: 256 },
  { name: 'icon_256x256@2x.png', size: 512 },
  { name: 'icon_512x512.png', size: 512 },
  { name: 'icon_512x512@2x.png', size: 1024 },
];

const run = (cmd, args, opts2 = {}) =>
  spawnSync(cmd, args, { cwd: root, stdio: opts2.quiet ? 'pipe' : 'inherit', ...opts2 });

function fail(msg) {
  console.error(`\n[make-icon] ${msg}`);
  process.exitCode = 1;
}

// ---------- ① 平台与工具链校验（非 macOS 必须清晰报错，绝不静默失败） ----------
if (process.platform !== 'darwin') {
  fail(
    `本脚本只能在 macOS 上运行（用系统自带 sips + iconutil 生成 icns），当前平台：${process.platform}。\n` +
    '  · 有 Mac：在 Mac 上执行 `node scripts/make-icon.mjs`，把生成的 build/icon.icns 拷回来（该文件已在 .gitignore 中，不入库）。\n' +
    '  · 没有 Mac：手工制作 —— 把 build/icon.png 转成 1024×1024 PNG，用任意在线/离线 png→icns 工具转换，放到 build/icon.icns。\n' +
    '  · 只是打 Windows 包：不需要 icns，`pnpm dist`（默认 Windows 目标）不会读它。'
  );
  process.exit(1);
}

const has = (cmd) => run(cmd, ['--help'], { quiet: true }).status !== 127;
if (!has('sips') || !has('iconutil')) {
  fail(
    '未找到 sips / iconutil。它们随 Xcode Command Line Tools 提供，请先安装：\n' +
    '  xcode-select --install\n' +
    '安装完成后重新执行：`node scripts/make-icon.mjs`'
  );
  process.exit(1);
}

// ---------- ② 源图校验 ----------
if (!existsSync(src)) {
  fail(`源图不存在：${src}\n请把正方形 PNG（建议 ≥1024×1024）放到该路径，或用 --src 指定其它文件。`);
  process.exit(1);
}
const srcBytes = statSync(src).size;
console.log(`[make-icon] source: ${src} (${srcBytes} B)`);

// ---------- ③ 生成 iconset ----------
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

for (const f of ICONSET_FILES) {
  const dest = join(iconset, f.name);
  // `sips -z H W` 缩放到精确尺寸；源图为正方形时不会变形。
  const r = run('sips', ['-z', String(f.size), String(f.size), src, '--out', dest], { quiet: true });
  if (r.status !== 0) {
    fail(`sips 生成 ${f.name}（${f.size}px）失败：${String(r.stderr || '').trim() || 'unknown error'}`);
    rmSync(iconset, { recursive: true, force: true });
    process.exit(1);
  }
  console.log(`[make-icon]   ${f.name}  (${f.size}px)`);
}

// ---------- ④ iconset → icns ----------
rmSync(target, { force: true });
const conv = run('iconutil', ['-c', 'icns', iconset, '-o', target], { quiet: true });
if (conv.status !== 0 || !existsSync(target)) {
  fail(`iconutil 转换失败：${String(conv.stderr || '').trim() || 'unknown error'}\n  保留中间产物以便排查：${iconset}`);
  process.exit(1);
}

if (!opts.keep) rmSync(iconset, { recursive: true, force: true });
console.log(`[make-icon] done: ${target} (${statSync(target).size} B)`);
console.log('[make-icon] 下一步：pnpm dist:mac');
