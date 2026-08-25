'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseSession } = require('../lib/parse-session');

const line = (obj) => JSON.stringify(obj);

test('ai-title 레코드가 있으면 제목으로 사용한다', () => {
  const text = [
    line({ type: 'ai-title', aiTitle: '포트나이트 MCP 설정', sessionId: 'abc-123' }),
    line({ type: 'user', message: { role: 'user', content: '첫 질문입니다' }, timestamp: '2026-08-24T05:23:31.539Z', cwd: 'C:\\work\\uefn' }),
  ].join('\n');
  const s = parseSession(text);
  assert.strictEqual(s.title, '포트나이트 MCP 설정');
  assert.strictEqual(s.sessionId, 'abc-123');
  assert.strictEqual(s.cwd, 'C:\\work\\uefn');
});

test('ai-title이 없으면 첫 프롬프트 앞 80자를 제목으로 사용한다', () => {
  const text = line({ type: 'user', message: { role: 'user', content: 'x'.repeat(200) }, timestamp: '2026-08-24T05:00:00.000Z' });
  const s = parseSession(text);
  assert.strictEqual(s.title, 'x'.repeat(80));
});

test('첫/마지막 프롬프트와 타임스탬프 min/max, 메시지 수를 계산한다', () => {
  const text = [
    line({ type: 'user', message: { role: 'user', content: '첫 프롬프트' }, timestamp: '2026-08-24T05:00:00.000Z' }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '답변' }] }, timestamp: '2026-08-24T05:01:00.000Z' }),
    line({ type: 'user', message: { role: 'user', content: '마지막 프롬프트' }, timestamp: '2026-08-24T05:02:00.000Z' }),
  ].join('\n');
  const s = parseSession(text);
  assert.strictEqual(s.firstPrompt, '첫 프롬프트');
  assert.strictEqual(s.lastPrompt, '마지막 프롬프트');
  assert.strictEqual(s.firstTimestamp, '2026-08-24T05:00:00.000Z');
  assert.strictEqual(s.lastTimestamp, '2026-08-24T05:02:00.000Z');
  assert.strictEqual(s.messageCount, 3);
  assert.strictEqual(s.empty, false);
});

test('tool_result만 있는 user 레코드와 사이드체인은 프롬프트로 취급하지 않는다', () => {
  const text = [
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '도구 결과' }] }, timestamp: '2026-08-24T05:00:00.000Z' }),
    line({ type: 'user', isSidechain: true, message: { role: 'user', content: '서브에이전트 프롬프트' }, timestamp: '2026-08-24T05:01:00.000Z' }),
  ].join('\n');
  const s = parseSession(text);
  assert.strictEqual(s.firstPrompt, null);
  assert.strictEqual(s.empty, true);
});

test('손상된 줄은 건너뛰고 계속 파싱한다', () => {
  const text = [
    '{"broken json',
    line({ type: 'user', message: { role: 'user', content: '정상 프롬프트' }, timestamp: '2026-08-24T05:00:00.000Z' }),
  ].join('\n');
  const s = parseSession(text);
  assert.strictEqual(s.firstPrompt, '정상 프롬프트');
});

test('빈 텍스트는 모두 null인 empty 세션을 반환한다', () => {
  const s = parseSession('');
  assert.strictEqual(s.empty, true);
  assert.strictEqual(s.title, null);
  assert.strictEqual(s.messageCount, 0);
});
