import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

// Protect the wiring that Electron's mouse regression exercises: click selects,
// double-click passes its own global index, and the play callback never uses a stale selection.
const source = readFileSync(new URL('../src/renderer/pages/DetailPage.tsx', import.meta.url), 'utf8');
const file = ts.createSourceFile('DetailPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const findFunction = (name: string): ts.FunctionDeclaration => {
  let found: ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
};

describe('detail episode playback intent', () => {
  it('取链失败不会把原始选集参数回退交给播放器，preparedUrl 也经过校验', () => {
    const play = findFunction('play').getText(file);
    expect(play).toContain('playbackResultError(r)');
    expect(play).toContain('onPlay(r.url,');
    expect(play).not.toContain('r.url || target.url');
    const player = readFileSync(new URL('../src/renderer/pages/PlayerPage.tsx', import.meta.url), 'utf8');
    expect(player).toContain('playbackResultError(r)');
    expect(player).not.toContain('setActiveUrl(target.url)');
  });
  it('封面与背景加载不进入播放链路，简介仍展示源数据', () => {
    const player = readFileSync(new URL('../src/renderer/pages/PlayerPage.tsx', import.meta.url), 'utf8');
    for (const content of [source, player]) {
      const parsed = ts.createSourceFile('page.tsx', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const calls: string[] = [];
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText(parsed) === 'client') calls.push(node.expression.name.text);
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      expect(calls).not.toContain('metaSearch');
      expect(calls).not.toContain('metaExtra');
      expect(calls).not.toContain('metaImages');
      expect(calls).toContain('play');
    }
    expect(findFunction('play').getText(file)).not.toMatch(/useCovers|metaSearch|metaDiscoverImages/);
    expect(source).toContain("pic: detail?.pic || fromListPic || ''");
    expect(source).toContain("const introText = (detail?.des || '').trim()");
  });

  it('single-click updates selection without switching or opening a player', () => {
    const choose = findFunction('chooseEp').getText(file);
    expect(choose).toContain('setEp(i)');
    expect(choose).not.toMatch(/playerSwitchEp|playerIsOpen|onPlay\(|client\.play\(/);
  });

  it('double-click submits the clicked global index, not the asynchronous selection state', () => {
    const attributes: ts.JsxAttribute[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText(file) === 'onDoubleClick') attributes.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(attributes.some(a => /play\(gi\)/.test(a.getText(file)))).toBe(true);
    const play = findFunction('play');
    expect(play.parameters[0].name.getText(file)).toBe('index');
    expect(play.parameters[0].initializer?.getText(file)).toBe('ep');
    expect(play.body?.getText(file)).toContain('const target = eps[index]');
    expect(play.body?.getText(file)).toContain('epIndex: index');
    expect(play.body?.getText(file)).not.toMatch(/eps\[ep\]|epIndex:\s*ep\b/);
  });

  it('the play button calls play rather than passing the MouseEvent as an episode index', () => {
    expect(source).not.toContain('onClick={play}');
    expect(source).toContain('onClick={() => { void play(); }}');
  });

  it('main-window playback handoff carries the complete episode context', () => {
    const app = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('client.playerSwitchEp({');
    expect(app).toMatch(/key:\s*fromKey/);
    expect(app).toMatch(/vodId:\s*meta\?\.vodId\s*\|\|\s*id/);
    expect(app).toMatch(/flag:\s*meta\?\.flag\s*\|\|\s*''/);
    expect(app).toContain('episodes: eps');
    expect(app).toContain('epIndex: idx');
  });

  it('player-local previous/next switching updates init.epIndex before resolving', () => {
    const player = readFileSync(new URL('../src/renderer/pages/PlayerPage.tsx', import.meta.url), 'utf8');
    expect(player).toMatch(/const next = \{ \.\.\.init, startTime: 0, lastUrl: '' \};\s*\/\/[^\n]*\n\s*next\.epIndex = idx/);
    expect(player).toContain('idx >= 0 && idx < init.episodes.length');
  });
});
