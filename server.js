'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { scanSessions } = require('./lib/scan-sessions');
const { getKeybindings, setKeybinding, unsetKeybinding } = require('./lib/wt-keybindings');
const { trashSessions } = require('./lib/trash-sessions');
const { parseSession, extractUserPrompts, extractConversation } = require('./lib/parse-session');
const { buildHandoffMd } = require('./lib/handoff');

const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

const PORT = 7777;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;
const cache = new Map();

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const hasWt = spawnSync('where', ['wt'], { windowsHide: true }).status === 0;

const WT_SETTINGS_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
  path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows Terminal', 'settings.json'),
];

function wtSettingsPath() {
  return WT_SETTINGS_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

// 열기 방식: window(새 창) / tab(기존 창 새 탭) / split-right(오른쪽 분할) / split-down(아래 분할)
const OPEN_MODES = {
  window: ['-w', 'new', 'nt'],
  tab: ['-w', '0', 'nt'],
  'split-right': ['-w', '0', 'sp', '-V'],
  'split-down': ['-w', '0', 'sp', '-H'],
};

function normalizeMode(mode) {
  return OPEN_MODES[mode] ? mode : 'tab';
}

function launchInTerminal(cwd, claudeCmd, mode) {
  let child;
  if (hasWt) {
    const openArgs = OPEN_MODES[normalizeMode(mode)];
    child = spawn('wt', [...openArgs, '-d', cwd, 'cmd', '/k', claudeCmd], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('cmd', ['/c', 'start', '"claude"', 'cmd', '/k', `cd /d "${cwd}" && ${claudeCmd}`], {
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
  }
  child.unref();
}

function launchResume(cwd, sessionId, mode) {
  launchInTerminal(cwd, `claude --resume ${sessionId}`, mode);
}

// 새 터미널에서 fresh claude 세션을 열고 핸드오프 문서부터 읽게 한다
function launchFreshClaude(cwd, mode) {
  launchInTerminal(cwd, 'claude "CLAUDE-HANDOFF.md 파일을 읽고 맥락을 파악한 뒤 다음 해야 할 일부터 이어서 작업해줘"', mode);
}

function openFolder(cwd) {
  const child = spawn('explorer.exe', [cwd], { detached: true, stdio: 'ignore' });
  child.unref();
}

function validCwd(res, cwd) {
  if (!cwd || !fs.existsSync(cwd)) {
    sendJson(res, 400, { error: `작업 폴더가 존재하지 않습니다: ${cwd || '(없음)'}` });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/sessions') {
      sendJson(res, 200, scanSessions(PROJECTS_DIR, cache));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/wt-keybindings') {
      const settingsPath = wtSettingsPath();
      if (!settingsPath) {
        sendJson(res, 200, { available: false, shortcuts: [] });
        return;
      }
      sendJson(res, 200, { available: true, shortcuts: getKeybindings(fs.readFileSync(settingsPath, 'utf8')) });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/wt-keybindings') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { id, keys } = body || {};
      // keys가 null이면 "등록 안 함"(해제) 요청이다
      if (!id || (keys !== null && (!keys || !/^[a-z0-9+,\-=]+$/i.test(keys)))) {
        sendJson(res, 400, { error: '단축키 형식이 올바르지 않습니다.' });
        return;
      }
      const settingsPath = wtSettingsPath();
      if (!settingsPath) {
        sendJson(res, 400, { error: 'Windows Terminal settings.json을 찾을 수 없습니다.' });
        return;
      }
      const original = fs.readFileSync(settingsPath, 'utf8');
      let updated;
      try {
        updated = keys === null ? unsetKeybinding(original, id) : setKeybinding(original, id, keys);
      } catch (err) {
        sendJson(res, 400, { error: err.message });
        return;
      }
      // 쓰기 전 백업 — WT가 파일 변경을 감지해 즉시 반영한다
      fs.writeFileSync(settingsPath + '.csm-backup', original);
      fs.writeFileSync(settingsPath, updated);
      sendJson(res, 200, { ok: true, shortcuts: getKeybindings(updated) });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/conversation?')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const projectDir = params.get('projectDir') || '';
      const sessionId = params.get('sessionId') || '';
      if (!SAFE_NAME_RE.test(projectDir) || !SAFE_NAME_RE.test(sessionId) ||
          ['.', '..'].includes(projectDir) || ['.', '..'].includes(sessionId)) {
        sendJson(res, 400, { error: '세션 정보가 올바르지 않습니다.' });
        return;
      }
      const src = path.join(PROJECTS_DIR, projectDir, sessionId + '.jsonl');
      if (!fs.existsSync(src)) {
        sendJson(res, 400, { error: '세션 파일을 찾을 수 없습니다.' });
        return;
      }
      sendJson(res, 200, { turns: extractConversation(fs.readFileSync(src, 'utf8'), 40) });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/handoff-preview?')) {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const projectDir = params.get('projectDir') || '';
      const sessionId = params.get('sessionId') || '';
      if (!SAFE_NAME_RE.test(projectDir) || !SAFE_NAME_RE.test(sessionId) ||
          ['.', '..'].includes(projectDir) || ['.', '..'].includes(sessionId)) {
        sendJson(res, 400, { error: '세션 정보가 올바르지 않습니다.' });
        return;
      }
      const src = path.join(PROJECTS_DIR, projectDir, sessionId + '.jsonl');
      if (!fs.existsSync(src)) {
        sendJson(res, 400, { error: '세션 파일을 찾을 수 없습니다.' });
        return;
      }
      const text = fs.readFileSync(src, 'utf8');
      const meta = parseSession(text);
      const md = buildHandoffMd({
        ...meta,
        sessionId,
        prompts: extractUserPrompts(text, 30),
        backupPath: path.join(PROJECTS_DIR, '.csm-session-backups', projectDir, sessionId + '.jsonl'),
      });
      sendJson(res, 200, { md, handoffPath: meta.cwd ? path.join(meta.cwd, 'CLAUDE-HANDOFF.md') : null });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/open-backups') {
      const dir = path.join(PROJECTS_DIR, '.csm-session-backups');
      fs.mkdirSync(dir, { recursive: true });
      openFolder(dir);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/speedup') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { projectDir, sessionId } = body || {};
      if (!SAFE_NAME_RE.test(String(projectDir || '')) || !SAFE_NAME_RE.test(String(sessionId || '')) ||
          ['.', '..'].includes(projectDir) || ['.', '..'].includes(sessionId)) {
        sendJson(res, 400, { error: '세션 정보가 올바르지 않습니다.' });
        return;
      }
      const src = path.join(PROJECTS_DIR, projectDir, sessionId + '.jsonl');
      if (!fs.existsSync(src)) {
        sendJson(res, 400, { error: '세션 파일을 찾을 수 없습니다.' });
        return;
      }
      const text = fs.readFileSync(src, 'utf8');
      const meta = parseSession(text);
      if (!validCwd(res, meta.cwd)) return;
      // 1) 원본 세션을 백업 폴더 한곳에 모아둔다 (원본도 그대로 남음)
      const backupDir = path.join(PROJECTS_DIR, '.csm-session-backups', projectDir);
      fs.mkdirSync(backupDir, { recursive: true });
      const backupPath = path.join(backupDir, sessionId + '.jsonl');
      fs.copyFileSync(src, backupPath);
      // 2) 작업 폴더에 핸드오프 문서 생성
      const handoffPath = path.join(meta.cwd, 'CLAUDE-HANDOFF.md');
      const md = buildHandoffMd({
        ...meta,
        sessionId,
        prompts: extractUserPrompts(text, 30),
        backupPath,
      });
      fs.writeFileSync(handoffPath, md, 'utf8');
      // 3) 새 터미널에서 fresh 세션 시작
      launchFreshClaude(meta.cwd, body.mode);
      sendJson(res, 200, { ok: true, handoffPath, backupPath });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/trash-sessions') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const items = Array.isArray(body && body.items) ? body.items : [];
      if (!items.length) {
        sendJson(res, 400, { error: '삭제할 세션이 없습니다.' });
        return;
      }
      sendJson(res, 200, trashSessions(PROJECTS_DIR, items));
      return;
    }
    if (req.method === 'POST' && (req.url === '/api/resume' || req.url === '/api/open-folder')) {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { sessionId, cwd } = body || {};
      if (req.url === '/api/open-folder') {
        if (!validCwd(res, cwd)) return;
        openFolder(cwd);
        sendJson(res, 200, { ok: true });
        return;
      }
      if (!SESSION_ID_RE.test(String(sessionId || ''))) {
        sendJson(res, 400, { error: '세션 ID 형식이 올바르지 않습니다.' });
        return;
      }
      if (!validCwd(res, cwd)) return;
      launchResume(cwd, sessionId, body.mode);
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Claude 세션 매니저: http://localhost:${PORT}`);
});
