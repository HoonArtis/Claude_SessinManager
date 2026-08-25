'use strict';

const PROMPT_MAX = 300;

// 컨텍스트 오염으로 세션을 초기화할 때 새 세션에 넘길 핸드오프 문서.
// 새 세션의 Claude가 이 파일을 읽고 맥락을 파악한 뒤 이어서 작업한다.
function buildHandoffMd(info) {
  const {
    title, cwd, gitBranch, sessionId,
    firstTimestamp, lastTimestamp, messageCount,
    prompts = [], backupPath,
  } = info;
  const lines = [];
  lines.push(`# 세션 핸드오프 — ${title || '(제목 없음)'}`);
  lines.push('');
  lines.push('이전 Claude Code 세션이 컨텍스트 한도에 가까워져 초기화되었습니다.');
  lines.push('이 문서를 읽고 맥락을 파악한 뒤 "다음 해야 할 일"부터 이어서 작업하세요.');
  lines.push('');
  lines.push('## 세션 정보');
  lines.push('');
  lines.push(`- 작업 폴더: ${cwd || '-'}`);
  lines.push(`- git 브랜치: ${gitBranch || '-'}`);
  lines.push(`- 기간: ${firstTimestamp || '-'} ~ ${lastTimestamp || '-'}`);
  lines.push(`- 메시지 수: ${messageCount || 0}`);
  lines.push(`- 원본 세션 ID: ${sessionId || '-'}`);
  if (backupPath) lines.push(`- 세션 백업: ${backupPath}`);
  lines.push('');
  lines.push('## 이 세션에서 다룬 요청 이력 (시간순)');
  lines.push('');
  for (const p of prompts) {
    const one = p.replace(/\s+/g, ' ').slice(0, PROMPT_MAX);
    lines.push(`- ${one}`);
  }
  if (!prompts.length) lines.push('- (기록 없음)');
  lines.push('');
  lines.push('## 다음 해야 할 일');
  lines.push('');
  lines.push('- [ ] 위 요청 이력의 마지막 항목이 어디까지 진행됐는지 작업 폴더 상태(git status, 최근 파일)로 확인');
  lines.push('- [ ] 미완료 작업 이어서 진행');
  lines.push('- [ ] (사용자가 직접 추가할 내용)');
  lines.push('');
  return lines.join('\n');
}

module.exports = { buildHandoffMd };
