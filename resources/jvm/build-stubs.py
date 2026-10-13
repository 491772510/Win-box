#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""重建 stubs.jar（build-stubs.sh 的 Python 等价实现）。

为什么不用 shell 版：build-stubs.sh 用 `find | while read; cygpath` 逐文件转路径，
每个文件 fork 一个 cygpath 子进程 → 本机跑不完就被超时杀掉。
这里全程在 Python 内完成，只在最后调一次 javac。

用法:
  python build_stubs.py <jvmDir>
     jvmDir = resources/jvm（含 stubs-src/、stubs/、libs/、SpiderRunner.java）

★ 2026-10-13 补充：`stubs-src/` 下的**非 .java 文件**（典型是
  `META-INF/services/java.nio.spi.CharsetProvider`）也会一并打进 jar。
  原因：stubs.jar 是构建产物（被 .gitignore 排除），SPI 声明若只在 jar 里
  改，仓库里就丢了出处；放源码目录才有可追溯性。
  注意：JVM 的 `ServiceLoader` 用 **system classloader** 找 classpath 上的
  `META-INF/services/*`，而 stubs.jar 正好在蜘蛛 JVM 的 -cp 里，所以能生效。
"""
import os
import re
import shutil
import subprocess
import sys
import zipfile

JDK = r'C:\Program Files\Java\jdk-17'
JAVAC = os.path.join(JDK, 'bin', 'javac.exe')

WIN = re.compile(r'^\s*Windows\s+', re.I)


def main():
    jvm = os.path.abspath(sys.argv[1])
    src = os.path.join(jvm, 'stubs-src')
    base_jar = os.path.join(jvm, 'stubs', 'stubs.jar')
    libs_dir = os.path.join(jvm, 'libs')
    work = os.path.join(os.environ.get('LOCALAPPDATA', r'C:\Temp'), 'Temp', 'stubwork')

    if os.path.isdir(work):
        shutil.rmtree(work)
    os.makedirs(work)

    # 1) 解基线 jar（保留 com.github.catvod.* 等历史类与资源）
    shutil.copy2(base_jar, os.path.join(work, '_base.jar'))
    baseline = []
    with zipfile.ZipFile(os.path.join(work, '_base.jar')) as z:
        for n in z.namelist():
            if n.endswith('/'):
                continue
            baseline.append(n)
            dst = os.path.join(work, n.replace('/', os.sep))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with z.open(n) as f, open(dst, 'wb') as o:
                shutil.copyfileobj(f, o)
    os.remove(os.path.join(work, '_base.jar'))
    # 与 shell 版一致：基线里的 shell-shim DexNative 由源码重新编
    dead = os.path.join(work, 'com', 'github', 'catvod', 'spider', 'DexNative.class')
    if os.path.exists(dead):
        os.remove(dead)
        baseline = [b for b in baseline if b != 'com/github/catvod/spider/DexNative.class']

    # 2) 收集源码：stubs-src 全量（跳过 shell-shim 子目录，它由构建时另行处理）+ SpiderRunner
    sources = []
    for root, dirs, files in os.walk(src):
        # 跳过 shell-shim（与 shell 版 `-path '*/shell-shim' -prune` 一致）
        dirs[:] = [d for d in dirs if d != 'shell-shim']
        for f in files:
            if f.endswith('.java'):
                sources.append(os.path.join(root, f))
    runner = os.path.join(jvm, 'SpiderRunner.java')
    if os.path.isfile(runner):
        sources.append(runner)
    py_runner = os.path.join(jvm, 'PythonRunner.java')
    if os.path.isfile(py_runner) and any(
            f.startswith('jython-standalone') for f in os.listdir(libs_dir)):
        sources.append(py_runner)
    sources.sort()
    print('源码数: %d' % len(sources))

    # 3) javac
    libs = [os.path.join(libs_dir, f) for f in sorted(os.listdir(libs_dir)) if f.endswith('.jar')]
    cp = work + ';' + ';'.join(libs)
    argfile = os.path.join(work, '_files.txt')
    with open(argfile, 'w', encoding='utf-8') as f:
        for s in sources:
            f.write('"%s"\n' % s.replace('\\', '/'))
    cmd = [JAVAC, '-encoding', 'UTF-8', '-nowarn', '-cp', cp,
           '-sourcepath', src, '-d', work, '@' + argfile]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if p.stdout:
        print('--- javac stdout ---')
        print(p.stdout[:8000])
    if p.returncode != 0:
        print('--- javac stderr ---')
        print((p.stderr or '')[:8000])
        print('javac 失败，退出码 %d' % p.returncode)
        return 1
    if p.stderr:
        print('--- javac stderr(警告) ---')
        print(p.stderr[:3000])

    # 3.5) 收集 stubs-src/META-INF 下的资源（主要是 services 的 SPI 声明）
    #      shell 版没有这一步：它只编 .java，于是 SPI 声明只能手工塞进 jar，
    #      而 jar 不进仓库 → 换台机器重建就丢。
    #      ★ 只取 META-INF：同目录下的 build-stubs.sh/ps1 是构建脚本，不该进 jar。
    resources = []
    meta_src = os.path.join(src, 'META-INF')
    if os.path.isdir(meta_src):
        for root, _d, files in os.walk(meta_src):
            for f in files:
                sp = os.path.join(root, f)
                rel = os.path.relpath(sp, src).replace(os.sep, '/')
                dst = os.path.join(work, rel.replace('/', os.sep))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                shutil.copy2(sp, dst)
                resources.append(rel)
    if resources:
        print('资源文件: %d（%s）' % (len(resources), ', '.join(sorted(resources)[:5])))

    # 4) 重新打包：基线文件 + 本次编译出的全部 .class
    classes = []
    for root, _d, files in os.walk(work):
        for f in files:
            if not f.endswith('.class'):
                continue
            p2 = os.path.join(root, f)
            classes.append(os.path.relpath(p2, work).replace(os.sep, '/'))
    entries = sorted(set(baseline) | set(classes) | set(resources))
    tmp_out = os.path.join(work, '_out.jar')
    with zipfile.ZipFile(tmp_out, 'w', zipfile.ZIP_DEFLATED) as z:
        for e in entries:
            z.write(os.path.join(work, e.replace('/', os.sep)), e)
    shutil.copy2(tmp_out, base_jar)
    print('built %s（%d classes / %d 条目）' % (base_jar, len(classes), len(entries)))
    return 0


sys.exit(main())
