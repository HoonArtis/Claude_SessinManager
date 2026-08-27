'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { readDefaultFolder, withDefaultFolder } = require('../lib/new-session');

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
