'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractConversation, extractConversationFull } = require('../lib/parse-session');

const line = (obj) => JSON.stringify(obj);

test('사람 프롬프트는 전문, assistant 턴은 하나로 접어서 반환한다', () => {
  const text = [
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '첫 질문' } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '답변 A' }] } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '답변 B' }] } }),
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '둘째 질문' } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '답변 C' }] } }),
  ].join('\n');
  assert.deepStrictEqual(extractConversation(text), [
    { role: 'user', text: '첫 질문' },
    { role: 'assistant' },
    { role: 'user', text: '둘째 질문' },
    { role: 'assistant' },
  ]);
});

test('extractConversationFull은 assistant 응답 전문을 담고 연속 레코드를 합친다', () => {
  const text = [
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '첫 질문' } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '답변 A' }] } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '답변 B' }] } }),
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '둘째 질문' } }),
  ].join('\n');
  assert.deepStrictEqual(extractConversationFull(text), [
    { role: 'user', text: '첫 질문' },
    { role: 'assistant', text: '답변 A\n\n답변 B' },
    { role: 'user', text: '둘째 질문' },
  ]);
});

test('tool_result·사이드체인·커맨드 래퍼는 대화에 넣지 않는다', () => {
  const text = [
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '진짜 질문' } }),
    line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }),
    line({ type: 'user', isSidechain: true, origin: { kind: 'human' }, message: { role: 'user', content: '사이드체인' } }),
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '<command-name>/clear</command-name>' } }),
  ].join('\n');
  assert.deepStrictEqual(extractConversation(text), [{ role: 'user', text: '진짜 질문' }]);
});

test('limit이 있으면 마지막 N개 항목만 반환한다', () => {
  const parts = [];
  for (let i = 1; i <= 5; i++) {
    parts.push(line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '질문 ' + i } }));
    parts.push(line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '답 ' + i }] } }));
  }
  const conv = extractConversation(parts.join('\n'), 4);
  assert.strictEqual(conv.length, 4);
  assert.deepStrictEqual(conv[0], { role: 'user', text: '질문 4' });
  assert.deepStrictEqual(conv[3], { role: 'assistant' });
});

test('텍스트 없는 assistant 레코드(도구 호출만)는 턴으로 세지 않는다', () => {
  const text = [
    line({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: '질문' } }),
    line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } }),
  ].join('\n');
  assert.deepStrictEqual(extractConversation(text), [{ role: 'user', text: '질문' }]);
});
