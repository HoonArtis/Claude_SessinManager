'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { scanSessions } = require('./lib/scan-sessions');
const { getKeybindings, setKeybinding, unsetKeybinding } = require('./lib/wt-keybindings');
const { trashSessions } = require('./lib/trash-sessions');
const { parseSession, extractUserPrompts, extractConversation, extractConversationFull } = require('./lib/parse-session');
const { buildHandoffMd } = require('./lib/handoff');

const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

const PORT = 7777;
const DISCOVERY_PORT = 7778;
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// ---- 원격(로컬망) 설정 — config.json (git 미추적) ----
// { "remote": { "enabled": true, "key": "공유 비밀키", "name": "표시 이름" } }
const CONFIG = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
})();
const REMOTE = CONFIG.remote || {};
const REMOTE_ON = REMOTE.enabled === true && typeof REMOTE.key === 'string' && REMOTE.key.length >= 8;
const MY_NAME = REMOTE.name || os.hostname();
const INSTANCE_ID = crypto.randomUUID();

function keyMatches(given) {
  if (typeof given !== 'string' || !REMOTE.key) return false;
  const a = Buffer.from(given), b = Buffer.from(REMOTE.key);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isLoopback(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// ---- 로컬망 자동 발견: UDP 브로드캐스트 비콘 ----
// 듣기는 항상 (원격 미설정 PC도 켜진 허브를 발견해서 페어링할 수 있게),
// 알리기는 원격이 켜진 서버만 한다.
const peers = new Map(); // host -> { name, port, lastSeen }
{
  const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', () => {});
  udp.on('message', (msg, rinfo) => {
    try {
      const b = JSON.parse(msg.toString('utf8'));
      if (b.t !== 'csm' || b.id === INSTANCE_ID) return;
      peers.set(rinfo.address, { name: String(b.name || rinfo.address).slice(0, 60), port: PORT, lastSeen: Date.now() });
    } catch { /* 잘못된 패킷 무시 */ }
  });
  udp.bind(DISCOVERY_PORT, () => {
    try { udp.setBroadcast(true); } catch {}
    if (REMOTE_ON) {
      const beacon = () => {
        const payload = Buffer.from(JSON.stringify({ t: 'csm', id: INSTANCE_ID, name: MY_NAME, port: PORT }));
        try { udp.send(payload, DISCOVERY_PORT, '255.255.255.255'); } catch {}
      };
      beacon();
      setInterval(beacon, 5000).unref();
    }
  });
}

// ---- 페어링: 코드 한 번 입력으로 상대 PC가 설정 없이 합류 ----
let pairing = null; // { code, expires, tries }

function writeRemoteConfig(key, name) {
  const cfg = { ...CONFIG, remote: { enabled: true, key, name } };
  fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfg, null, 2));
}

// 방화벽 허용(TCP 7777/UDP 7778)을 관리자 권한으로 시도 — UAC 창이 한 번 뜬다
function tryFirewallElevated() {
  // remoteip=localsubnet — 같은 서브넷에서 온 패킷만 허용 (인터넷 발 트래픽은 규칙 차원에서 차단)
  const rules = 'netsh advfirewall firewall add rule name=CSM_TCP_7777 dir=in action=allow protocol=TCP localport=7777 remoteip=localsubnet & netsh advfirewall firewall add rule name=CSM_UDP_7778 dir=in action=allow protocol=UDP localport=7778 remoteip=localsubnet';
  try {
    const child = spawn('powershell', ['-WindowStyle', 'Hidden', '-Command',
      `Start-Process cmd -ArgumentList '/c ${rules}' -Verb RunAs -WindowStyle Hidden`,
    ], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
  } catch { /* 사용자가 UAC를 거부해도 치명적이지 않음 */ }
}

// 새 코드로 재시작 (업데이트/페어링 공용)
function restartSelf() {
  setTimeout(() => {
    const child = spawn('wscript', [path.join(__dirname, 'restart.vbs')], {
      cwd: __dirname, detached: true, stdio: 'ignore',
    });
    child.unref();
    process.exit(0);
  }, 300);
}

function freshPeers() {
  const now = Date.now();
  return [...peers.entries()]
    .filter(([, p]) => now - p.lastSeen < 20000)
    .map(([host, p]) => ({ host, name: p.name }));
}
const SESSION_ID_RE = /^[0-9a-fA-F-]{8,64}$/;
const cache = new Map();

// 원격 프롬프트 체인: claude -p --resume가 새 세션으로 분기하는 경우,
// 원본 세션 ID -> 최신 분기 ID 를 기록해 대화가 한 줄기로 이어지게 한다
const CHAINS_PATH = path.join(PROJECTS_DIR, '.csm-chains.json');
function loadChains() {
  try {
    return JSON.parse(fs.readFileSync(CHAINS_PATH, 'utf8'));
  } catch {
    return {};
  }
}
function resolveChain(sessionId, projectDir) {
  const latest = loadChains()[sessionId];
  if (latest && fs.existsSync(path.join(PROJECTS_DIR, projectDir, latest + '.jsonl'))) return latest;
  return sessionId;
}

// 사용자가 바꾼 세션 이름 — 세션 파일(.jsonl)은 건드리지 않고 사이드카에 보관한다
const TITLES_PATH = path.join(PROJECTS_DIR, '.csm-titles.json');
function loadTitles() {
  try {
    return JSON.parse(fs.readFileSync(TITLES_PATH, 'utf8'));
  } catch {
    return {};
  }
}

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

// 이 서버가 Claude Code 세션 안에서 실행됐을 수 있다. 그 표식이 자식(claude/터미널)에
// 대물림되면 새 세션이 대화 기록을 저장하지 않으므로, 실행 환경에서 항상 제거한다.
const CLEAN_ENV = { ...process.env };
for (const k of Object.keys(CLEAN_ENV)) {
  if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete CLEAN_ENV[k];
}

// 부팅 시점의 커밋 = 지금 실행 중인 코드의 버전 (이후 pull로 HEAD가 움직여도 불변)
const BOOT_COMMIT = (() => {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: __dirname, windowsHide: true, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
})();

// 부팅 직후 백그라운드로 원격 확인만 해둔다 (받을지는 사용자가 결정)
setTimeout(() => {
  try {
    spawn('git', ['fetch', '--quiet'], { cwd: __dirname, windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  } catch { /* git 없음/오프라인 — 무시 */ }
}, 2000);

const WT_SETTINGS_CANDIDATES = [
  path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
  path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
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
    child = spawn('wt', [...openArgs, '-d', cwd, 'cmd', '/k', claudeCmd], { detached: true, stdio: 'ignore', env: CLEAN_ENV });
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

// --- 브라우저 탭이 모두 닫히면 서버 자동 종료 ---
// 페이지가 SSE(/api/alive)로 연결을 유지한다. 연결 수가 0이 되면 GRACE_MS 뒤 종료
// (새로고침·재접속 여유). 시작 후 아무도 접속하지 않으면 BOOT_GRACE_MS 뒤 종료.
const GRACE_MS = 15000;
const BOOT_GRACE_MS = 60000;
let aliveClients = 0;
let shutdownTimer = setTimeout(() => process.exit(0), BOOT_GRACE_MS);

function cancelShutdown() {
  if (shutdownTimer) { clearTimeout(shutdownTimer); shutdownTimer = null; }
}

function scheduleShutdown(ms) {
  cancelShutdown();
  shutdownTimer = setTimeout(() => {
    if (aliveClients <= 0) {
      console.log('브라우저가 모두 닫혀 서버를 종료합니다.');
      process.exit(0);
    }
  }, ms);
}

const server = http.createServer(async (req, res) => {
  try {
    // 외부(로컬망)에서 온 요청은 공유 비밀키가 맞아야만 통과.
    // 예외: /api/pair-request 는 페어링 코드로 자체 검증한다.
    if (!isLoopback(req) && req.url !== '/api/pair-request') {
      if (!REMOTE_ON || !keyMatches(req.headers['x-csm-key'])) {
        sendJson(res, 403, { error: '인증 실패: 공유 키가 없거나 일치하지 않습니다.' });
        return;
      }
    }
    if (req.method === 'GET' && req.url === '/api/peers') {
      sendJson(res, 200, { enabled: REMOTE_ON, name: MY_NAME, peers: freshPeers() });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/pair-code') {
      // (내 브라우저 전용) 5분짜리 일회용 페어링 코드 발급 — 이 코드를 상대 PC에서 입력한다
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      if (!REMOTE_ON) { sendJson(res, 400, { error: '먼저 원격을 켜야 합니다.' }); return; }
      pairing = { code: String(crypto.randomInt(100000, 1000000)), expires: Date.now() + 5 * 60000, tries: 0 };
      sendJson(res, 200, { code: pairing.code, expiresInSec: 300 });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/pair-request') {
      // (상대 PC의 서버가 호출) 코드가 맞으면 공유 키를 넘겨준다 — 일회용, 5회 실패 시 무효화
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      if (!REMOTE_ON || !pairing || Date.now() > pairing.expires) {
        sendJson(res, 400, { error: '진행 중인 페어링이 없습니다. 허브 컴퓨터에서 코드를 먼저 발급하세요.' });
        return;
      }
      if (String(body.code || '') !== pairing.code) {
        pairing.tries += 1;
        if (pairing.tries >= 5) pairing = null;
        sendJson(res, 400, { error: '코드가 일치하지 않습니다.' });
        return;
      }
      pairing = null; // 일회용
      console.log(`페어링 승인: ${body.name || req.socket.remoteAddress}`);
      sendJson(res, 200, { key: REMOTE.key, name: MY_NAME });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/pair-init') {
      // (내 브라우저 전용) 이 컴퓨터를 원격 허브로 켠다: 키 생성 + 방화벽 시도 + 재시작
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      if (REMOTE_ON) { sendJson(res, 200, { ok: true, already: true }); return; }
      writeRemoteConfig(crypto.randomBytes(24).toString('hex'), os.hostname());
      tryFirewallElevated();
      sendJson(res, 200, { ok: true });
      restartSelf();
      return;
    }
    if (req.method === 'POST' && req.url === '/api/pair-join') {
      // (내 브라우저 전용) 발견된 허브에 코드로 합류: 키 받아서 저장 + 방화벽 시도 + 재시작
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { host, code } = body || {};
      if (!peers.has(String(host))) { sendJson(res, 400, { error: '발견된 컴퓨터가 아닙니다.' }); return; }
      const payload = Buffer.from(JSON.stringify({ code: String(code || ''), name: os.hostname() }));
      const fwd = http.request({ host, port: PORT, path: '/api/pair-request', method: 'POST', timeout: 8000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length } }, (r) => {
        let data = '';
        r.on('data', (d) => { data += d; });
        r.on('end', () => {
          try {
            const resp = JSON.parse(data);
            if (r.statusCode !== 200) { sendJson(res, 400, { error: resp.error || '페어링 실패' }); return; }
            writeRemoteConfig(resp.key, os.hostname());
            tryFirewallElevated();
            sendJson(res, 200, { ok: true, peerName: resp.name });
            restartSelf();
          } catch (err) {
            sendJson(res, 502, { error: '응답 해석 실패: ' + err.message });
          }
        });
      });
      fwd.on('timeout', () => fwd.destroy(new Error('timeout')));
      fwd.on('error', (err) => sendJson(res, 502, { error: '허브 연결 실패: ' + err.message }));
      fwd.write(payload);
      fwd.end();
      return;
    }
    if (req.method === 'POST' && req.url === '/api/remote') {
      // 브라우저 → 내 서버 → 상대 서버 프록시 (키는 서버끼리만 주고받는다)
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { host, apiPath } = body || {};
      const ALLOWED = ['/api/sessions', '/api/conversation', '/api/conversation-full', '/api/version', '/api/resume', '/api/prompt'];
      if (!REMOTE_ON) {
        sendJson(res, 400, { error: '원격 기능이 꺼져 있습니다 (config.json 확인).' });
        return;
      }
      if (!peers.has(host)) {
        sendJson(res, 400, { error: '발견된 컴퓨터가 아닙니다: ' + host });
        return;
      }
      if (!ALLOWED.some((p) => String(apiPath || '').split('?')[0] === p)) {
        sendJson(res, 400, { error: '허용되지 않은 원격 경로입니다.' });
        return;
      }
      const payload = body.body === undefined ? null : Buffer.from(JSON.stringify(body.body));
      const fwd = http.request({
        host, port: PORT, path: apiPath, method: payload ? 'POST' : 'GET', timeout: 15000,
        headers: { 'x-csm-key': REMOTE.key, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': payload.length } : {}) },
      }, (r) => {
        res.writeHead(r.statusCode || 502, { 'Content-Type': r.headers['content-type'] || 'application/json; charset=utf-8' });
        r.pipe(res); // 스트리밍 응답(/api/prompt)도 그대로 흘려보낸다
      });
      fwd.on('timeout', () => fwd.destroy(new Error('timeout')));
      fwd.on('error', (err) => {
        if (!res.headersSent) sendJson(res, 502, { error: '상대 서버 연결 실패: ' + err.message });
        else res.end('\n[연결 끊김: ' + err.message + ']');
      });
      if (payload) fwd.write(payload);
      fwd.end();
      // 프롬프트는 오래 걸릴 수 있으므로 프록시 요청의 타임아웃을 늘린다
      if (String(apiPath).startsWith('/api/prompt')) fwd.setTimeout(15 * 60 * 1000);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/prompt') {
      // 세션에 프롬프트를 이어서 실행하고(claude -p --resume) 출력을 스트리밍으로 돌려준다.
      // 프롬프트는 stdin으로 전달 — 셸 인젝션 원천 차단.
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { projectDir, sessionId, prompt } = body || {};
      if (!SAFE_NAME_RE.test(String(projectDir || '')) || !SESSION_ID_RE.test(String(sessionId || '')) ||
          typeof prompt !== 'string' || !prompt.trim() || prompt.length > 20000) {
        sendJson(res, 400, { error: '요청이 올바르지 않습니다.' });
        return;
      }
      const src = path.join(PROJECTS_DIR, projectDir, sessionId + '.jsonl');
      if (!fs.existsSync(src)) {
        sendJson(res, 400, { error: '세션 파일을 찾을 수 없습니다.' });
        return;
      }
      // 이전 원격 대화가 분기됐다면 최신 체인에 이어붙인다 — 대화가 한 줄기로 계속되게
      const effectiveId = resolveChain(sessionId, projectDir);
      const effSrc = path.join(PROJECTS_DIR, projectDir, effectiveId + '.jsonl');
      const meta = parseSession(fs.readFileSync(fs.existsSync(effSrc) ? effSrc : src, 'utf8'));
      if (!meta.cwd || !fs.existsSync(meta.cwd)) {
        sendJson(res, 400, { error: `작업 폴더가 존재하지 않습니다: ${meta.cwd || '(없음)'}` });
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
      // stream-json: assistant 메시지가 나오는 대로 스트리밍, 마지막 result에서 분기 ID를 체인에 기록
      const child = spawn('cmd', ['/c', 'claude', '-p', '--resume', effectiveId, '--output-format', 'stream-json', '--verbose'], {
        cwd: meta.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: CLEAN_ENV,
      });
      const killer = setTimeout(() => { try { child.kill(); } catch {} }, 10 * 60 * 1000);
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
      let outBuf = '';
      let errBuf = '';
      child.stdout.on('data', (d) => {
        outBuf += d.toString('utf8');
        let nl;
        while ((nl = outBuf.indexOf('\n')) >= 0) {
          const line = outBuf.slice(0, nl).trim();
          outBuf = outBuf.slice(nl + 1);
          if (!line) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
              const text = ev.message.content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n');
              if (text) res.write(text + '\n');
            } else if (ev.type === 'result') {
              if (ev.session_id && ev.session_id !== effectiveId) {
                const chains = loadChains();
                chains[sessionId] = ev.session_id;
                fs.writeFileSync(CHAINS_PATH, JSON.stringify(chains, null, 2));
              }
              if (ev.is_error && ev.result) res.write('\n[오류] ' + ev.result);
            }
          } catch { /* JSON이 아닌 줄은 무시 */ }
        }
      });
      child.stderr.on('data', (d) => { errBuf += d.toString('utf8'); });
      child.on('close', (code) => {
        clearTimeout(killer);
        if (code !== 0) res.write(`\n[claude 종료 코드 ${code}] ${errBuf.slice(0, 2000)}`);
        res.end();
      });
      child.on('error', (err) => {
        clearTimeout(killer);
        res.end('\n[실행 실패: ' + err.message + ']');
      });
      req.on('close', () => { try { child.kill(); } catch {} });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/alive') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('data: ok\n\n');
      aliveClients++;
      cancelShutdown();
      const ping = setInterval(() => res.write(':ping\n\n'), 30000);
      req.on('close', () => {
        clearInterval(ping);
        aliveClients--;
        if (aliveClients <= 0) scheduleShutdown(GRACE_MS);
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/') {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/version') {
      // behind  = 원격에만 있는 커밋 수 (받아야 함 → 업데이트 모달)
      // restart = 디스크에는 있는데 실행 중인 프로세스에 반영 안 된 커밋 수 (재시작만 하면 됨)
      const opts = { cwd: __dirname, windowsHide: true, encoding: 'utf8' };
      const count = (range) => {
        const r = spawnSync('git', ['rev-list', '--count', range], opts);
        return r.status === 0 ? parseInt(r.stdout.trim(), 10) || 0 : 0;
      };
      sendJson(res, 200, {
        commit: BOOT_COMMIT,
        behind: count('HEAD..origin/master'),
        restart: BOOT_COMMIT ? count(`${BOOT_COMMIT}..HEAD`) : 0,
        clients: aliveClients, // 서버를 붙잡고 있는 열린 탭 수
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/api/sessions') {
      const titles = loadTitles();
      const chainChildren = new Set(Object.values(loadChains())); // 분기된 자식 세션은 목록에서 숨김 (원본 카드가 대화 전체를 대표)
      sendJson(res, 200, scanSessions(PROJECTS_DIR, cache)
        .filter((s) => !chainChildren.has(s.sessionId))
        .map((s) => {
          const custom = titles[`${s.projectDir}/${s.sessionId}`];
          return custom ? { ...s, title: custom } : s;
        }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/rename') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { projectDir, sessionId, title } = body || {};
      if (!SAFE_NAME_RE.test(String(projectDir || '')) || !SAFE_NAME_RE.test(String(sessionId || '')) ||
          ['.', '..'].includes(projectDir) || ['.', '..'].includes(sessionId)) {
        sendJson(res, 400, { error: '세션 정보가 올바르지 않습니다.' });
        return;
      }
      const titles = loadTitles();
      const key = `${projectDir}/${sessionId}`;
      const trimmed = String(title == null ? '' : title).trim().slice(0, 200);
      if (trimmed) titles[key] = trimmed;
      else delete titles[key]; // 빈 이름으로 저장하면 원래 제목으로 되돌린다
      fs.writeFileSync(TITLES_PATH, JSON.stringify(titles, null, 2));
      sendJson(res, 200, { ok: true, title: trimmed || null });
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
      // keys가 null이면 "등록 안 함"(해제) 요청이다.
      // 키 이름에는 [ ] ; . / 같은 문자도 오므로 출력 가능한 ASCII면 허용한다 (JSON에만 기록되므로 안전)
      if (!id || (keys !== null && (typeof keys !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(keys)))) {
        sendJson(res, 400, { error: '단축키 형식이 올바르지 않습니다: ' + JSON.stringify(keys) });
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
    if (req.method === 'GET' && req.url.startsWith('/api/conversation-full?')) {
      // 원격 채팅 패널용: 사람 프롬프트 + Claude 응답 전문 (마지막 N턴)
      const params = new URL(req.url, 'http://localhost').searchParams;
      const projectDir = params.get('projectDir') || '';
      const sessionId = params.get('sessionId') || '';
      const limit = Math.min(parseInt(params.get('limit') || '30', 10) || 30, 200);
      if (!SAFE_NAME_RE.test(projectDir) || !SAFE_NAME_RE.test(sessionId) ||
          ['.', '..'].includes(projectDir) || ['.', '..'].includes(sessionId)) {
        sendJson(res, 400, { error: '세션 정보가 올바르지 않습니다.' });
        return;
      }
      // 분기 체인이 있으면 최신 분기 파일을 읽는다 (분기 파일에는 이전 대화가 통째로 복사되어 있음)
      const src = path.join(PROJECTS_DIR, projectDir, resolveChain(sessionId, projectDir) + '.jsonl');
      if (!fs.existsSync(src)) {
        sendJson(res, 400, { error: '세션 파일을 찾을 수 없습니다.' });
        return;
      }
      const turns = extractConversationFull(fs.readFileSync(src, 'utf8')).slice(-limit);
      sendJson(res, 200, { turns });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/export?')) {
      // 세션 대화 전문을 마크다운 파일로 다운로드
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
      const titles = loadTitles();
      const title = titles[`${projectDir}/${sessionId}`] || meta.title || '(제목 없음)';
      const turns = extractConversationFull(text);
      const md = [
        `# ${title}`,
        '',
        `- 작업 폴더: ${meta.cwd || '-'}`,
        `- 기간: ${meta.firstTimestamp || '-'} ~ ${meta.lastTimestamp || '-'}`,
        `- 메시지 ${meta.messageCount}개 · 토큰 ${meta.totalTokens.toLocaleString()}`,
        `- 세션 ID: ${sessionId}`,
        '',
        '---',
        '',
        ...turns.map((t) => (t.role === 'user' ? `## 🙋 나\n\n${t.text}\n` : `## 🤖 Claude\n\n${t.text}\n`)),
      ].join('\n');
      const fname = title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.md';
      res.writeHead(200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`,
      });
      res.end(md);
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/export-raw?')) {
      // 세션 원본(.jsonl) 그대로 다운로드 — 다른 PC의 .claude\projects\<projectDir>\에 넣으면 이어서 쓸 수 있다
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
      res.writeHead(200, {
        'Content-Type': 'application/jsonl; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sessionId}.jsonl"`,
        'X-Project-Dir': projectDir,
      });
      fs.createReadStream(src).pipe(res);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/resume-multi') {
      // 선택한 세션 여러 개를 한 창에서 분할(또는 탭)로 한꺼번에 연다
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const items = Array.isArray(body && body.items) ? body.items : [];
      const asTabs = body.mode === 'tabs';
      const max = asTabs ? 8 : 4;
      if (!items.length || items.length > max) {
        sendJson(res, 400, { error: `세션은 1~${max}개까지 선택할 수 있습니다.` });
        return;
      }
      for (const it of items) {
        if (!SESSION_ID_RE.test(String(it.sessionId || '')) || !it.cwd || !fs.existsSync(it.cwd)) {
          sendJson(res, 400, { error: `세션 정보가 올바르지 않습니다: ${it.sessionId || '(없음)'}` });
          return;
        }
      }
      if (!hasWt) {
        // WT가 없으면 분할이 불가하므로 각각 새 창으로 연다
        for (const it of items) launchResume(it.cwd, it.sessionId, 'window');
        sendJson(res, 200, { ok: true, fallback: 'windows' });
        return;
      }
      // wt 한 번 호출로 새 탭 + 분할들을 이어붙인다.
      // 2개: 좌|우, 3개: 좌(전체높이)|우상/우하, 4개: 2x2(田) — 4번째는 왼쪽으로 포커스를 옮겨 쪼갠다
      const args = [];
      items.forEach((it, i) => {
        if (i > 0) args.push(';');
        if (i === 0) args.push('-w', 'new', 'nt');
        else if (i === 1) args.push('sp', '-V');
        else if (i === 2) args.push('sp', '-H');
        else args.push('mf', 'left', ';', 'sp', '-H');
        args.push('-d', it.cwd, 'cmd', '/k', `claude --resume ${it.sessionId}`);
      });
      const child = spawn('wt', args, { detached: true, stdio: 'ignore', env: CLEAN_ENV });
      child.unref();
      sendJson(res, 200, { ok: true });
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
    if (req.method === 'POST' && req.url === '/api/update') {
      // 새 버전 받기(git pull) 후 새 코드로 자동 재시작
      const pull = spawnSync('git', ['pull', '--ff-only'], { cwd: __dirname, windowsHide: true, encoding: 'utf8' });
      if (pull.status !== 0) {
        sendJson(res, 500, { error: '업데이트 실패: ' + ((pull.stderr || pull.stdout || '알 수 없는 오류').trim()) });
        return;
      }
      sendJson(res, 200, { ok: true });
      restartSelf();
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
      // 원격 프롬프트로 분기된 대화가 있으면 최신 줄기를 연다
      const chained = loadChains()[sessionId];
      launchResume(cwd, chained || sessionId, body.mode);
      sendJson(res, 200, { ok: true });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: err.message });
  }
});

// 원격 기능이 켜져 있으면 로컬망에도 연다 (외부 요청은 공유 키 인증 필수)
server.listen(PORT, REMOTE_ON ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Claude 세션 매니저: http://localhost:${PORT}` + (REMOTE_ON ? ` (원격 켜짐: ${MY_NAME})` : ''));
});
