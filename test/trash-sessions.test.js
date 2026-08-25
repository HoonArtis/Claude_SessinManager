'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { trashSessions } = require('../lib/trash-sessions');
const { scanSessions } = require('../lib/scan-sessions');

const line = (obj) => JSON.stringify(obj);

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-trash-'));
  const dirA = path.join(root, 'C--work-projA');
  fs.mkdirSync(dirA);
  fs.writeFileSync(
    path.join(dirA, 'aaaa-1111.jsonl'),
    line({ type: 'user', message: { role: 'user', content: '세션 A' }, timestamp: '2026-08-01T00:00:00.000Z' }),
  );
  fs.writeFileSync(
    path.join(dirA, 'bbbb-2222.jsonl'),
    line({ type: 'user', message: { role: 'user', content: '세션 B' }, timestamp: '2026-08-02T00:00:00.000Z' }),
  );
  return root;
}

test('세션 파일을 .csm-trash로 이동한다 (완전 삭제 아님)', () => {
  const root = makeFixture();
  const result = trashSessions(root, [{ projectDir: 'C--work-projA', sessionId: 'aaaa-1111' }]);
  assert.strictEqual(result.moved, 1);
  assert.strictEqual(result.errors.length, 0);
  assert.ok(!fs.existsSync(path.join(root, 'C--work-projA', 'aaaa-1111.jsonl')), '원본은 사라져야 한다');
  assert.ok(fs.existsSync(path.join(root, '.csm-trash', 'C--work-projA', 'aaaa-1111.jsonl')), '휴지통에 존재해야 한다');
  fs.rmSync(root, { recursive: true, force: true });
});

test('경로 조작 시도(.., 슬래시)는 거부한다', () => {
  const root = makeFixture();
  const result = trashSessions(root, [
    { projectDir: '..', sessionId: 'aaaa-1111' },
    { projectDir: 'C--work-projA', sessionId: '../../evil' },
  ]);
  assert.strictEqual(result.moved, 0);
  assert.strictEqual(result.errors.length, 2);
  fs.rmSync(root, { recursive: true, force: true });
});

test('없는 파일은 에러로 보고하고 나머지는 계속 이동한다', () => {
  const root = makeFixture();
  const result = trashSessions(root, [
    { projectDir: 'C--work-projA', sessionId: 'no-such' },
    { projectDir: 'C--work-projA', sessionId: 'bbbb-2222' },
  ]);
  assert.strictEqual(result.moved, 1);
  assert.strictEqual(result.errors.length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test('스캐너는 .csm-trash 등 점(.)으로 시작하는 폴더를 무시한다', () => {
  const root = makeFixture();
  trashSessions(root, [{ projectDir: 'C--work-projA', sessionId: 'aaaa-1111' }]);
  const sessions = scanSessions(root, new Map());
  assert.strictEqual(sessions.length, 1);
  assert.strictEqual(sessions[0].sessionId, 'bbbb-2222');
  fs.rmSync(root, { recursive: true, force: true });
});
