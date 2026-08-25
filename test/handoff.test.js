'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractUserPrompts } = require('../lib/parse-session');
const { buildHandoffMd } = require('../lib/handoff');

const line = (obj) => JSON.stringify(obj);

test('extractUserPrompts는 사람 프롬프트만 순서대로 추출한다', () => {
  const text = [
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '첫 요청' }, timestamp: '2026-08-24T05:00:00.000Z' }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: '스킬 주입' }] } }),
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '둘째 요청' }, timestamp: '2026-08-24T05:01:00.000Z' }),
  ].join('\n');
  assert.deepStrictEqual(extractUserPrompts(text), ['첫 요청', '둘째 요청']);
});

test('extractUserPrompts는 limit이 있으면 마지막 N개만 반환한다', () => {
  const text = ['하나', '둘', '셋']
    .map((p) => line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: p } }))
    .join('\n');
  assert.deepStrictEqual(extractUserPrompts(text, 2), ['둘', '셋']);
});

test('buildHandoffMd는 세션 정보, 요청 이력, 다음 할 일 섹션을 포함한다', () => {
  const md = buildHandoffMd({
    title: '테스트 세션',
    cwd: 'C:\\work\\proj',
    gitBranch: 'main',
    sessionId: 'abc-123',
    firstTimestamp: '2026-08-24T05:00:00.000Z',
    lastTimestamp: '2026-08-24T06:00:00.000Z',
    messageCount: 42,
    prompts: ['첫 요청', '둘째 요청'],
    backupPath: 'X:\\backup\\abc-123.jsonl',
  });
  assert.ok(md.includes('# 세션 핸드오프 — 테스트 세션'));
  assert.ok(md.includes('C:\\work\\proj'));
  assert.ok(md.includes('첫 요청'));
  assert.ok(md.includes('둘째 요청'));
  assert.ok(md.includes('## 다음 해야 할 일'));
  assert.ok(md.includes('abc-123'));
  assert.ok(md.includes('X:\\backup\\abc-123.jsonl'));
});

test('buildHandoffMd는 긴 프롬프트를 300자로 줄인다', () => {
  const md = buildHandoffMd({ title: 't', cwd: 'c', prompts: ['x'.repeat(500)], messageCount: 1 });
  assert.ok(!md.includes('x'.repeat(301)));
  assert.ok(md.includes('x'.repeat(300)));
});
