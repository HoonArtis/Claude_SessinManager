'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseSession } = require('./parse-session');

function scanSessions(rootDir, cache = new Map()) {
  const sessions = [];
  let projectDirs;
  try {
    projectDirs = fs
      .readdirSync(rootDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
  } catch {
    return sessions;
  }
  for (const dir of projectDirs) {
    const dirPath = path.join(rootDir, dir.name);
    let files;
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      const cached = cache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        sessions.push(cached.data);
        continue;
      }
      let parsed;
      try {
        parsed = parseSession(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        console.warn(`세션 파일 읽기 실패, 건너뜀: ${filePath} (${err.message})`);
        continue;
      }
      const data = {
        ...parsed,
        sessionId: parsed.sessionId || path.basename(file, '.jsonl'),
        projectDir: dir.name,
      };
      cache.set(filePath, { mtimeMs: stat.mtimeMs, data });
      sessions.push(data);
    }
  }
  sessions.sort((a, b) => (b.lastTimestamp || '').localeCompare(a.lastTimestamp || ''));
  return sessions;
}

module.exports = { scanSessions };
