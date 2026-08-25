'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { scanSessions } = require('./lib/scan-sessions');
const { getKeybindings, setKeybinding } = require('./lib/wt-keybindings');

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

function launchResume(cwd, sessionId) {
  const claudeCmd = `claude --resume ${sessionId}`;
  const child = hasWt
    ? spawn('wt', ['-d', cwd, 'cmd', '/k', claudeCmd], { detached: true, stdio: 'ignore' })
    : spawn('cmd', ['/c', 'start', '"claude"', 'cmd', '/k', `cd /d "${cwd}" && ${claudeCmd}`], {
        detached: true,
        stdio: 'ignore',
        shell: false,
      });
  child.unref();
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
      if (!id || !keys || !/^[a-z0-9+\-=]+$/i.test(keys)) {
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
        updated = setKeybinding(original, id, keys);
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
      launchResume(cwd, sessionId);
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
