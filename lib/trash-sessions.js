'use strict';
const fs = require('node:fs');
const path = require('node:path');

const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

// 완전 삭제 대신 rootDir/.csm-trash/<projectDir>/ 로 이동한다.
// 잘못 지워도 파일을 다시 옮겨오면 복구된다.
function trashSessions(rootDir, items) {
  const result = { moved: 0, errors: [] };
  for (const item of items || []) {
    const { projectDir, sessionId } = item || {};
    if (!SAFE_NAME_RE.test(String(projectDir || '')) || !SAFE_NAME_RE.test(String(sessionId || '')) ||
        projectDir === '.' || projectDir === '..' || sessionId === '.' || sessionId === '..') {
      result.errors.push(`잘못된 이름: ${projectDir}/${sessionId}`);
      continue;
    }
    const src = path.join(rootDir, projectDir, sessionId + '.jsonl');
    if (!fs.existsSync(src)) {
      result.errors.push(`파일 없음: ${projectDir}/${sessionId}`);
      continue;
    }
    const trashDir = path.join(rootDir, '.csm-trash', projectDir);
    try {
      fs.mkdirSync(trashDir, { recursive: true });
      fs.renameSync(src, path.join(trashDir, sessionId + '.jsonl'));
      result.moved += 1;
    } catch (err) {
      result.errors.push(`이동 실패: ${projectDir}/${sessionId} (${err.message})`);
    }
  }
  return result;
}

module.exports = { trashSessions };
