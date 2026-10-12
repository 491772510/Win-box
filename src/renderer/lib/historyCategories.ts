import type { ProfileSitesView } from '../../shared/types';
import { findHistorySource, type HistorySourceRef } from './historySource';

export interface HistoryCategory<T> {
  key: string;
  label: string;
  items: T[];
}

/** 按订阅身份和源身份分组，名称相同也不能跨订阅混在一起。保留最近观看的顺序。 */
export function historyCategories<T extends HistorySourceRef>(items: readonly T[], view: ProfileSitesView): HistoryCategory<T>[] {
  const groups = new Map<string, HistoryCategory<T>>();
  for (const item of items) {
    // 已保存档案被删除时仍保留原身份，不把它归到当前同名源。
    const profile = item.profileId ? view.profiles.find((p) => p.id === item.profileId) : undefined;
    const hit = !item.profileId || profile ? findHistorySource(view, item) : null;
    const pid = item.profileId || hit?.profileId || '';
    const source = hit?.key || item.sourceKey || item.sourceName || '';
    const key = JSON.stringify([pid, source]);
    const label = `${profile?.name || hit?.profileName || (pid ? '已移除订阅' : '未知订阅')} - ${hit?.name || item.sourceName || item.sourceKey || '未知源'}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
