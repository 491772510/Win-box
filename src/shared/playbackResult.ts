import type { PlayResult } from './types';

/** 源站已确认的错误占位视频；不能因为扩展名是 mp4 就当作取链成功。 */
export function isErrorVideoUrl(raw: string): boolean {
  let url = (raw || '').trim();
  for (let depth = 0; depth < 4; depth++) {
    if (/^\/mizhicdn\/video\/error\.mp4(?:[?#]|$)/i.test(url)) return true;
    try {
      const parsed = new URL(url);
      if (/^\/mizhicdn\/video\/error\.mp4$/i.test(parsed.pathname)) return true;
      if (!/^https?:$/.test(parsed.protocol) || parsed.pathname !== '/play') return false;
      const inner = parsed.searchParams.get('url');
      if (!inner || inner === url) return false;
      url = inner;
    } catch { return false; }
  }
  return false;
}

/** 最终交给播放器的地址校验；原始选集 ID/JSON/相对路径必须先经蜘蛛取链。 */
export function directPlayUrlError(raw: string): string {
  const url = (raw || '').trim();
  if (!url) return '未能取得播放地址，请重试或切换线路';
  // TVBox 用 # 拼多段 URL；普通 fragment 仍属于同一地址。
  for (const part of url.split(/#(?=(?:https?|file):\/\/)/i)) {
    if (isErrorVideoUrl(part)) return '源站返回错误占位视频，未取得有效播放地址，请切换线路或稍后重试';
    if (/^[a-z]:[\\/]/i.test(part) || /^\\\\[^\\]+\\[^\\]+/.test(part)) continue;
    try {
      const parsed = new URL(part);
      if (/^(?:https?|file|rtmps?|rtspu?|mms|mmsh|udp|rtp|srt):$/i.test(parsed.protocol)
        && (parsed.protocol === 'file:' || !!parsed.hostname)) continue;
    } catch { /* 非 URL 是源内参数或相对路径，不能让 MPV 按本地文件打开。 */ }
    return '源站未返回有效播放地址（返回了选集参数或相对路径），请重试或切换线路';
  }
  return '';
}

export function playbackResultError(result: Pick<PlayResult, 'parse' | 'url' | 'message'>): string {
  if (result.parse !== 0) return result.message || '该播放地址需要网页解析/嗅探，自动解析未取得直连地址';
  const error = directPlayUrlError(result.url);
  return error ? result.message || error : '';
}
