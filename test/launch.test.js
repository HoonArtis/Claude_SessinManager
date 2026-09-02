'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  buildLaunchArgs, buildMultiPaneArgs, claudeCommandLine, assertSingleLine, normalizeMode,
} = require('../lib/launch');

// 줄바꿈 불변식이 "모든" 실행 경로에 걸리는지가 이 파일의 핵심.
// 예전엔 분할열기가 인자를 손으로 조립해 가드를 우회했다.

test('단일 실행: 줄바꿈 명령을 거부한다', () => {
  assert.throws(() => buildLaunchArgs({ cwd: 'C:\\w', command: 'a\nb', mode: 'tab', hasWt: true }), /줄바꿈/);
});

test('분할 실행: 줄바꿈 명령을 거부한다 — 우회 경로가 없어야 한다', () => {
  assert.throws(() => buildMultiPaneArgs([{ cwd: 'C:\\w', command: 'claude "설치\n  - /plugin install x"' }]), /줄바꿈/);
});

test('claudeCommandLine: 줄바꿈 인자를 거부한다', () => {
  assert.throws(() => claudeCommandLine('--resume a\nb'), /줄바꿈/);
  assert.strictEqual(claudeCommandLine('--resume abc'), 'claude --resume abc');
});

test('assertSingleLine: 빈 값은 통과(셸만 여는 경우)', () => {
  assert.strictEqual(assertSingleLine(null), null);
  assert.strictEqual(assertSingleLine(''), '');
});

test('분할 2개: 좌|우 (sp -V)', () => {
  const a = buildMultiPaneArgs([
    { cwd: 'C:\\a', command: 'claude --resume 1' },
    { cwd: 'C:\\b', command: 'claude --resume 2' },
  ]);
  assert.deepStrictEqual(a.slice(0, 3), ['-w', 'new', 'nt']);
  assert.ok(a.includes(';'));
  assert.ok(a.includes('sp') && a.includes('-V'));
  assert.ok(a.includes('C:\\a') && a.includes('C:\\b'));
});

test('분할 4개: 4번째는 왼쪽으로 포커스를 옮겨 쪼갠다 (2x2)', () => {
  const items = ['1', '2', '3', '4'].map((n) => ({ cwd: 'C:\\' + n, command: 'claude --resume ' + n }));
  const a = buildMultiPaneArgs(items);
  assert.ok(a.includes('mf'), 'move-focus가 있어야 2x2가 된다');
  assert.strictEqual(a.filter((x) => x === 'sp').length, 3);
});

test('분할 인자에 줄바꿈이 하나도 남지 않는다', () => {
  const a = buildMultiPaneArgs([{ cwd: 'C:\\a', command: claudeCommandLine('--resume abc') }]);
  assert.ok(!a.some((x) => /[\r\n]/.test(x)));
});

test('normalizeMode: 모르는 값은 tab으로', () => {
  assert.strictEqual(normalizeMode('없는모드'), 'tab');
  assert.strictEqual(normalizeMode('split-down'), 'split-down');
});

test('new-session에서 재수출한 buildLaunchArgs가 같은 함수다 — 출처가 하나여야 한다', () => {
  const viaNewSession = require('../lib/new-session').buildLaunchArgs;
  assert.strictEqual(viaNewSession, buildLaunchArgs);
});
