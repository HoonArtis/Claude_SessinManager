'use strict';

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((item) => item && item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n');
  }
  return '';
}

// origin.kind가 'human'이면 확실한 사용자 입력. origin 필드가 없는 구버전 기록은
// 문자열 content만 인정한다 — 배열 content는 스킬 주입/도구 결과이기 때문.
function isHumanPrompt(rec) {
  if (rec.origin) return rec.origin.kind === 'human';
  return typeof rec.message.content === 'string';
}

// 슬래시 커맨드 실행 시 기록되는 시스템 래퍼 메시지 판별
const COMMAND_WRAPPER_RE = /^(<local-command-|<command-name>|Caveat: The messages below)/;

function isCommandWrapper(prompt) {
  return COMMAND_WRAPPER_RE.test(prompt);
}

function parseSession(text) {
  const result = {
    sessionId: null,
    cwd: null,
    title: null,
    firstPrompt: null,
    lastPrompt: null,
    firstTimestamp: null,
    lastTimestamp: null,
    messageCount: 0,
    gitBranch: null,
    empty: true,
  };
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.sessionId && !result.sessionId) result.sessionId = rec.sessionId;
    if (rec.cwd && !result.cwd) result.cwd = rec.cwd;
    if (rec.gitBranch && !result.gitBranch) result.gitBranch = rec.gitBranch;
    if (rec.type === 'ai-title' && rec.aiTitle) result.title = rec.aiTitle;
    if (rec.timestamp) {
      if (!result.firstTimestamp || rec.timestamp < result.firstTimestamp) result.firstTimestamp = rec.timestamp;
      if (!result.lastTimestamp || rec.timestamp > result.lastTimestamp) result.lastTimestamp = rec.timestamp;
    }
    if (rec.type === 'user' || rec.type === 'assistant') result.messageCount += 1;
    if (rec.type === 'user' && rec.isSidechain !== true && rec.message && isHumanPrompt(rec)) {
      const prompt = extractText(rec.message.content).trim();
      if (prompt && !isCommandWrapper(prompt)) {
        if (!result.firstPrompt) result.firstPrompt = prompt;
        result.lastPrompt = prompt;
        result.empty = false;
      }
    }
  }
  if (!result.title && result.firstPrompt) result.title = result.firstPrompt.slice(0, 80);
  return result;
}

// 세션 전체에서 사람이 입력한 프롬프트를 순서대로 추출한다.
// limit이 주어지면 마지막 limit개만 반환한다.
function extractUserPrompts(text, limit) {
  const prompts = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== 'user' || rec.isSidechain === true || !rec.message || !isHumanPrompt(rec)) continue;
    const prompt = extractText(rec.message.content).trim();
    if (prompt && !isCommandWrapper(prompt)) prompts.push(prompt);
  }
  return limit ? prompts.slice(-limit) : prompts;
}

module.exports = { parseSession, extractText, extractUserPrompts };
