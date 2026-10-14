// scripts/gen-okhttp-compat.mjs — 生成 resources/jvm/okhttp4-compat/winbox-okhttp4-compat.jar
//
// 产物 = 上游 `okhttp-3.14.9.jar` 里 `okhttp3/RequestBody.class` 的**复制 + 追加** okhttp 4.x
// 参数序的 `create` 重载（换序委托到同类 3.x 方法）。打成独立小 jar，由 JarSpiderBridge 排在
// `-cp` 最前 → 只影子这一个类，覆盖一切来源的调用者（含 Java 侧 runtime-dex 产物）。
//
// 为什么生成物要**入库/随构建产出**：打包后 resources/ 只读（asarUnpack），运行时无法落盘；
// 且 `resources/jvm/**/*.jar` 不进仓库（.gitignore）⇒ 需要它随构建现场产出（`scripts/build-main.mjs`
// 会调用本文件的 `generateOkHttp4Compat()`）。也可单独执行：`node scripts/gen-okhttp-compat.mjs`。
//
// 生成逻辑只有一份真相（src/engine/spider/okhttp4Compat.ts）—— 本脚本用 esbuild 现场把 TS
// bundle 成 .mjs 再调用，绝不在此复制粘贴类字节生成代码（两份代码必然漂移）。
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const src = resolve(root, '..');
const tmpDir = join(src, '.tmp');

/**
 * 由上游 okhttp jar 现场生成兼容 jar。上游缺失（未 provision 的资源环境）→ 返回 null（调用方应放行）。
 * @returns {Promise<{outJar: string, bytes: number, added: number}|null>}
 */
export async function generateOkHttp4Compat() {
  const upstreamJar = join(src, 'resources/jvm/libs', 'okhttp-3.14.9.jar');
  if (!existsSync(upstreamJar)) return null;

  const bundleFile = join(tmpDir, 'gen-okhttp-compat.bundle.mjs');
  const entry = `
import { buildOkHttp4CompatJar, OKHTTP_REQUEST_BODY, OKHTTP4_COMPAT_JAR } from './src/engine/spider/okhttp4Compat';
export { buildOkHttp4CompatJar, OKHTTP_REQUEST_BODY, OKHTTP4_COMPAT_JAR };
`;
  const result = await build({
    stdin: { contents: entry, resolveDir: src, sourcefile: 'gen-okhttp-compat-entry.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    write: false,
    logLevel: 'warning',
  });
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(bundleFile, result.outputFiles[0].text);
  let mod;
  try {
    mod = await import(pathToFileURL(bundleFile).href);
  } finally {
    rmSync(bundleFile, { force: true });
  }

  const r = mod.buildOkHttp4CompatJar(readFileSync(upstreamJar));
  if (!r.bytes) throw new Error(`上游 jar 里找不到可补丁的 ${mod.OKHTTP_REQUEST_BODY}（形态异常）`);
  const outJar = join(src, 'resources/jvm/okhttp4-compat', mod.OKHTTP4_COMPAT_JAR);
  mkdirSync(dirname(outJar), { recursive: true });
  writeFileSync(outJar, r.bytes);
  return { outJar, bytes: r.bytes.length, added: r.added };
}

// 直接执行时打印结果（构建脚本里 import 调用时只返回值）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = await generateOkHttp4Compat();
  if (!r) console.log('okhttp4-compat 跳过：上游 resources/jvm/libs/okhttp-3.14.9.jar 不存在（资源未 provision）');
  else console.log(`okhttp4-compat 已生成: ${r.outJar} (${r.bytes} bytes, 追加 ${r.added} 个重载)`);
}
