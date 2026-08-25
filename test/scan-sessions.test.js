'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSessions } = require('../lib/scan-sessions');

const line = (obj) => JSON.stringify(obj);

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-test-'));
  const dirA = path.join(root, 'C--work-projA');
  const dirB = path.join(root, 'C--work-projB');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  fs.writeFileSync(
    path.join(dirA, 'aaaa-1111.jsonl'),
    line({ type: 'user', message: { role: 'user', content: '오래된 세션' }, timestamp: '2026-08-01T00:00:00.000Z', cwd: 'C:\\work\\projA' }),
  );
  fs.writeFileSync(
    path.join(dirB, 'bbbb-2222.jsonl'),
    line({ type: 'user', message: { role: 'user', content: '최근 세션' }, timestamp: '2026-08-20T00:00:00.000Z', cwd: 'C:\\work\\projB' }),
  );
  fs.writeFileSync(path.join(dirB, 'not-a-session.txt'), 'ignore me');
  return root;
}

test('모든 프로젝트 폴더를 스캔해 마지막 활동순으로 정렬한다', () => {
  const root = makeFixture();
  const sessions = scanSessions(root, new Map());
  assert.strictEqual(sessions.length, 2);
  assert.strictEqual(sessions[0].firstPrompt, '최근 세션');
  assert.strictEqual(sessions[1].firstPrompt, '오래된 세션');
  fs.rmSync(root, { recursive: true, force: true });
});

test('레코드에 sessionId가 없으면 파일명을 사용하고 projectDir를 채운다', () => {
  const root = makeFixture();
  const sessions = scanSessions(root, new Map());
  const recent = sessions[0];
  assert.strictEqual(recent.sessionId, 'bbbb-2222');
  assert.strictEqual(recent.projectDir, 'C--work-projB');
  fs.rmSync(root, { recursive: true, force: true });
});

test('mtime이 같으면 캐시를 사용하고, 파일이 바뀌면 재파싱한다', () => {
  const root = makeFixture();
  const cache = new Map();
  scanSessions(root, cache);
  const filePath = path.join(root, 'C--work-projB', 'bbbb-2222.jsonl');
  // 캐시 데이터를 오염시켜 캐시 히트 여부를 관찰한다
  cache.get(filePath).data.title = 'CACHED';
  let sessions = scanSessions(root, cache);
  assert.strictEqual(sessions[0].title, 'CACHED');
  // 파일을 수정하고 mtime을 미래로 바꾸면 재파싱된다
  fs.writeFileSync(filePath, line({ type: 'user', message: { role: 'user', content: '수정된 세션' }, timestamp: '2026-08-21T00:00:00.000Z' }));
  fs.utimesSync(filePath, new Date(), new Date(Date.now() + 10000));
  sessions = scanSessions(root, cache);
  assert.strictEqual(sessions[0].firstPrompt, '수정된 세션');
  fs.rmSync(root, { recursive: true, force: true });
});

test('rootDir가 없으면 빈 배열을 반환한다', () => {
  const sessions = scanSessions(path.join(os.tmpdir(), 'csm-does-not-exist'), new Map());
  assert.deepStrictEqual(sessions, []);
});
