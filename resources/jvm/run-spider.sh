#!/usr/bin/env bash
# 真实蜘蛛冒烟测试 —— 用桌面 JVM 桥跑指定的 jar 蜘蛛方法。
#
# 用法：bash run-spider.sh <jar路径> <类名> <方法> [参数...]
#   例：bash run-spider.sh <converted.jar> com.github.catvod.spider.KungFu404 homeContent <ext>
#
# 目的：在**不改动应用**的前提下，用与 JarSpiderBridge 完全一致的 classpath/参数
# 复现蜘蛛调用，快速定位 NoSuchMethodError / NoSuchFieldError / ClassNotFoundException。
#
# ★ 2026-10-14：本脚本原先是 **Windows 专用**（写死 `jre/bin/java.exe` + `cygpath` +
#   分号分隔符），macOS 上直接跑不起来 —— 而排查「含 .so 的壳源在 mac 上为什么报
#   依赖安卓原生库」恰恰最需要它。现按平台自动切换：
#     · win32（Git Bash/MSYS）：`jre/bin/java.exe` + `cygpath -w` + `;`
#     · darwin / linux        ：`jre/bin/java`（兼容 `jre/Contents/Home/bin/java`）+ 原样路径 + `:`
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"

case "$(uname -s 2>/dev/null || echo unknown)" in
  MINGW*|MSYS*|CYGWIN*) HOST=win ;;
  Darwin) HOST=mac ;;
  *) HOST=nix ;;
esac

# ---- java 可执行：win 认 java.exe，darwin 两种 jlink/`.app` 常见布局都认 ----
if [ "$HOST" = win ]; then
  JAVA="$HERE/jre/bin/java.exe"
else
  for c in "$HERE/jre/bin/java" "$HERE/jre/Contents/Home/bin/java"; do
    [ -x "$c" ] && JAVA="$c" && break
  done
  JAVA="${JAVA:-$HERE/jre/bin/java}"
fi

# ---- 路径分隔符与「转成 JVM 能懂的路径」：win 走 cygpath，unix 原样（只补绝对路径） ----
if [ "$HOST" = win ]; then
  SEP=';'
  abspath() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || printf '%s' "$1"; }
else
  SEP=':'
  abspath() { printf '%s' "$(cd "$(dirname "$1")" 2>/dev/null && pwd)/$(basename "$1")"; }
fi

STUBS="$(abspath "$HERE/stubs/stubs.jar")"
LIBS="$(for f in "$HERE"/libs/*.jar; do abspath "$f"; done | paste -sd "$SEP")"
JAR="$(abspath "$1")"; CLASS="$2"; METHOD="$3"; shift 3
ARGS=("$@")
CP="$STUBS$SEP$LIBS$SEP$JAR"

if [ ! -x "$JAVA" ]; then
  echo "找不到可执行的 java: $JAVA" >&2
  echo "  macOS 需要把下载的 Temurin JRE 的 Contents/Home 放到 resources/jvm/jre/（见 docs/macos-build.md §2.1）" >&2
  exit 1
fi

# -noverify 必须与 JarSpiderBridge.ts 保持一致：
# dex2jar 产物的 StackMapTable 帧不完整，HotSpot(Java7+) 默认校验会抛
# VerifyError: Expecting a stackmap frame at branch target N（ART 不校验这些帧）。
"$JAVA" -noverify \
    -Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8 \
    -cp "$CP" SpiderRunner "$JAR" "$CLASS" "$METHOD" "${ARGS[@]}" 2>&1
