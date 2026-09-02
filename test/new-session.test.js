'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { readDefaultFolder, withDefaultFolder, buildLaunchArgs } = require('../lib/new-session');

test('기본 폴더가 없으면 홈 폴더로 폴백한다', () => {
  assert.strictEqual(readDefaultFolder({}), os.homedir());
  assert.strictEqual(readDefaultFolder(null), os.homedir());
  assert.strictEqual(readDefaultFolder({ newSession: {} }), os.homedir());
});

test('설정된 기본 폴더를 그대로 반환한다', () => {
  const cfg = { newSession: { defaultFolder: 'C:/work/proj' } };
  assert.strictEqual(readDefaultFolder(cfg), 'C:/work/proj');
});

test('withDefaultFolder는 기존 remote 키를 보존하며 기본 폴더만 넣는다', () => {
  const cfg = { remote: { enabled: true, key: 'secret', name: 'PC1' } };
  const next = withDefaultFolder(cfg, 'C:/work/proj');
  assert.deepStrictEqual(next.remote, { enabled: true, key: 'secret', name: 'PC1' });
  assert.strictEqual(next.newSession.defaultFolder, 'C:/work/proj');
  // 원본 불변
  assert.strictEqual(cfg.newSession, undefined);
});

test('withDefaultFolder는 기존 newSession의 다른 키를 보존한다', () => {
  const cfg = { newSession: { defaultFolder: 'C:/old', other: 1 } };
  const next = withDefaultFolder(cfg, 'C:/new');
  assert.strictEqual(next.newSession.defaultFolder, 'C:/new');
  assert.strictEqual(next.newSession.other, 1);
});

test('wt: 명령이 있으면 -d cwd 뒤에 cmd /k <명령>을 붙인다', () => {
  const { cmd, args } = buildLaunchArgs({ cwd: 'C:/w', command: 'claude', mode: 'window', hasWt: true });
  assert.strictEqual(cmd, 'wt');
  assert.deepStrictEqual(args, ['-w', 'new', 'nt', '-d', 'C:/w', 'cmd', '/k', 'claude']);
});

test('wt: 명령이 없으면 -d cwd 로 셸만 연다', () => {
  const { cmd, args } = buildLaunchArgs({ cwd: 'C:/w', command: null, mode: 'tab', hasWt: true });
  assert.strictEqual(cmd, 'wt');
  assert.deepStrictEqual(args, ['-w', '0', 'nt', '-d', 'C:/w']);
});

test('mode가 잘못되면 tab으로 정규화한다', () => {
  const { args } = buildLaunchArgs({ cwd: 'C:/w', command: null, mode: 'nope', hasWt: true });
  assert.deepStrictEqual(args, ['-w', '0', 'nt', '-d', 'C:/w']);
});

test('wt 없음: 명령이 있으면 start로 새 창을 열고 cd 후 명령 실행', () => {
  const { cmd, args } = buildLaunchArgs({ cwd: 'C:/w', command: 'claude', mode: 'tab', hasWt: false });
  assert.strictEqual(cmd, 'cmd');
  assert.deepStrictEqual(args, ['/c', 'start', '"claude"', 'cmd', '/k', 'cd /d "C:/w" && claude']);
});

test('wt 없음: 명령이 없으면 cd만 하고 셸을 남긴다', () => {
  const { args } = buildLaunchArgs({ cwd: 'C:/w', command: null, mode: 'tab', hasWt: false });
  assert.strictEqual(args[args.length - 1], 'cd /d "C:/w"');
});

// 회귀: 하네스 설치 프롬프트가 6줄이라 cmd /k 인자에 넣으면 첫 줄만 전달되고
// "무엇을 설치할지"가 사라졌다. 이제 조용히 깨지지 않고 즉시 실패한다.
test('여러 줄 명령은 거부한다 — 줄바꿈은 명령줄에서 잘려 나간다', () => {
  const multi = 'claude "설치해줘\n  - /plugin install superpowers@superpowers-marketplace"';
  assert.throws(() => buildLaunchArgs({ cwd: 'C:\w', command: multi, mode: 'tab', hasWt: true }), /줄바꿈/);
  assert.throws(() => buildLaunchArgs({ cwd: 'C:\w', command: 'a\rb', mode: 'tab', hasWt: false }), /줄바꿈/);
});

test('한 줄 명령은 그대로 통과한다', () => {
  const one = 'claude "C:\Temp\csm-install\harness-1.md 파일을 읽고 그 안의 지시대로 실행해줘"';
  const { args } = buildLaunchArgs({ cwd: 'C:\w', command: one, mode: 'tab', hasWt: true });
  assert.ok(args.includes(one));
  assert.ok(!args.some((a) => /[\r\n]/.test(a)));
});
