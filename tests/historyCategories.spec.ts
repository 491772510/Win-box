import { describe, expect, it } from 'vitest';
import { historyCategories } from '../src/renderer/lib/historyCategories';
import type { ProfileSitesView } from '../src/shared/types';

const view: ProfileSitesView = {
  activeId: 'b',
  profiles: [
    { id: 'a', name: '订阅甲', sites: [{ key: 'same', name: '公共源' }, { key: 'only', name: '独有源' }] },
    { id: 'b', name: '订阅乙', sites: [{ key: 'same', name: '公共源' }] },
  ],
};

describe('历史记录订阅/源分类', () => {
  it('按订阅和源分组，跨订阅同 key 不合并，保留最近观看顺序', () => {
    const items = [
      { id: 1, profileId: 'b', sourceKey: 'same', sourceName: '旧名称' },
      { id: 2, profileId: 'a', sourceKey: 'same' },
      { id: 3, profileId: 'b', sourceKey: 'same' },
      { id: 4, profileId: 'a', sourceKey: 'only' },
    ];
    const groups = historyCategories(items, view);
    expect(groups.map((g) => g.label)).toEqual(['订阅乙 - 公共源', '订阅甲 - 公共源', '订阅甲 - 独有源']);
    expect(groups[0].items.map((i) => i.id)).toEqual([1, 3]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
    expect(items.map((i) => i.id)).toEqual([1, 2, 3, 4]);
  });

  it('旧记录没有订阅 ID 时按源反查，未找到的历史仍可展示', () => {
    const groups = historyCategories([{ sourceKey: 'only' }, { sourceName: '失效源' }], view);
    expect(groups.map((g) => g.label)).toEqual(['订阅甲 - 独有源', '未知订阅 - 失效源']);
    expect(historyCategories([], view)).toEqual([]);
  });

  it('已删除订阅不误归入当前订阅的同名源', () => {
    const groups = historyCategories([
      { profileId: 'deleted', sourceKey: 'same', sourceName: '原始源' },
      { profileId: 'b', sourceKey: 'same' },
      { profileId: 'a', sourceKey: 'removed', sourceName: '已移除源' },
    ], view);
    expect(groups.map((g) => g.label)).toEqual(['已移除订阅 - 原始源', '订阅乙 - 公共源', '订阅甲 - 已移除源']);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });
});
