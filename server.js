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
const { readDefaultFolder, withDefaultFolder } = require('./lib/new-session');
const { buildLaunchArgs, buildMultiPaneArgs, claudeSpawn, claudeCommandLine } = require('./lib/launch');
const { parseSession, extractUserPrompts, extractConversation, extractConversationFull } = require('./lib/parse-session');
const { buildHandoffMd } = require('./lib/handoff');
const { loadCatalog, buildMcpAddArgs, buildHarnessPrompt, buildInstallFixPrompt, parseInstalledMcps, parseInstalledPlugins } = require('./lib/mcp-catalog');
const { uefnLogPath, parseVerseProjectRoot } = require('./lib/uefn-detect');

const SAFE_NAME_RE = /^[a-zA-Z0-9._-]+$/;

const PORT = Number(process.env.CSM_PORT) || 7777;
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

// 현재 브랜치가 추적하는 원격 브랜치(예: origin/master). 감지·적용이 같은 기준을 쓰게 하는 단일 출처.
// (기존엔 감지만 origin/master로 고정돼, master 아닌 브랜치에선 pull(=@{upstream}) 대상과 어긋나 업데이트가 안 먹었음)
const UPSTREAM = (() => {
  const r = spawnSync('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
    { cwd: __dirname, windowsHide: true, encoding: 'utf8' });
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

// 프로세스 실행 경로는 lib/launch가 단일 출처 — 여기 한 곳을 고치면 모든 실행이 함께 바뀐다.
// command가 falsy면 그 폴더에서 셸만 연다(claude 없이).
function launchInTerminal(cwd, command, mode) {
  const { cmd, args } = buildLaunchArgs({ cwd, command, mode, hasWt });
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: CLEAN_ENV });
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

// 여러 줄 프롬프트는 명령줄 인자로 넘길 수 없다 — Windows에서 줄바꿈이 명령을 끊어
// 첫 줄만 전달되고 "무엇을 설치할지"가 통째로 사라진다.
// 그래서 프롬프트를 파일로 쓰고, 그 파일을 읽으라는 한 줄짜리 지시만 넘긴다.
function launchClaudeWithPrompt(cwd, prompt, mode, tag) {
  const dir = path.join(os.tmpdir(), 'csm-install');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${tag}-${Date.now()}.md`);
  fs.writeFileSync(file, prompt, 'utf8');
  const line = `claude "${file} 파일을 읽고 그 안의 지시대로 실행해줘"`;
  if (/[\r\n]/.test(line)) throw new Error('실행 명령에 줄바꿈이 남아 있습니다');
  launchInTerminal(cwd, line, mode);
  return file;
}

// claude CLI 실행. Windows에서 npm -g로 설치하면 claude.cmd만 있는데
// spawn은 .cmd를 직접 못 열어 ENOENT가 난다 — resolveCommand가 실제 파일을 찾아 감싼다.
function runClaude(argv, opts = {}) {
  const { cmd, args } = claudeSpawn(argv, CLEAN_ENV);
  return spawnSync(cmd, args, { encoding: 'utf8', env: CLEAN_ENV, windowsHide: true, ...opts });
}

// 설치된 MCP/플러그인 이름을 CLI로 조회(실패해도 빈 배열).
function detectInstalled() {
  const result = { mcp: [], harness: [] };
  try {
    const r = runClaude(['mcp', 'list'], { timeout: 20000 });
    if (r.stdout) result.mcp = [...parseInstalledMcps(r.stdout)];
  } catch {}
  try {
    const r = runClaude(['plugin', 'list'], { timeout: 20000 });
    if (r.stdout) result.harness = [...parseInstalledPlugins(r.stdout)];
  } catch {}
  return result;
}

function validCwd(res, cwd) {
  if (!cwd || !fs.existsSync(cwd)) {
    sendJson(res, 400, { error: `작업 폴더가 존재하지 않습니다: ${cwd || '(없음)'}` });
    return false;
  }
  return true;
}

// config.json을 디스크에서 새로 읽는다(인메모리 CONFIG는 시작 시점 값이라 최신이 아닐 수 있음).
function loadConfigFresh() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

// 기본 폴더를 config.json에 머지 저장(원격 키 보존, 쓰기 전 백업).
function saveDefaultFolder(folder) {
  const p = path.join(__dirname, 'config.json');
  const cfg = loadConfigFresh();
  if (fs.existsSync(p)) fs.copyFileSync(p, p + '.csm-backup');
  fs.writeFileSync(p, JSON.stringify(withDefaultFolder(cfg, folder), null, 2));
}

// 네이티브 폴더 선택창(PowerShell)을 띄우고 고른 경로를 resolve. 취소 시 null.
// 서버(백그라운드)에서 띄운 다이얼로그는 브라우저 뒤로 숨을 수 있어, TopMost
// 소유자 폼을 만들어 다이얼로그를 최상단으로 끌어온다.
// 현재 열려 있는 폴더 선택창 하나(재클릭 시 이전 것을 닫고 새로 연다).
let activePick = null;

function pickFolderDialog(seed) {
  return new Promise((resolve) => {
    // 이미 열린 선택창이 있으면 그 프로세스를 종료(창 닫힘)하고 새로 연다.
    if (activePick) { try { activePick.cancel(); } catch {} }

    // 상주 http 서버(백그라운드)가 직접 spawn한 powershell은 숨김 상태 상속/포그라운드
    // 권한 문제로 다이얼로그가 화면에 안 뜬다. → 앱이 쓰는 방식(launch.vbs)처럼 wscript로
    // powershell을 최상위 독립 프로세스로 띄우고, 결과는 임시 파일로 주고받는다.
    // 모던 탐색기형 창(IFileOpenDialog)은 lib/pick-folder.ps1이 담당한다.
    const id = crypto.randomBytes(6).toString('hex');
    const dir = os.tmpdir();
    const outPath = path.join(dir, `csm-pick-${id}.txt`);
    const pidPath = path.join(dir, `csm-pick-${id}.pid`);
    const vbsPath = path.join(dir, `csm-pick-${id}.vbs`);
    const ps1 = path.join(__dirname, 'lib', 'pick-folder.ps1');
    const q = (s) => String(s || '').replace(/"/g, '');
    const vbs = 'Set sh = CreateObject("WScript.Shell")\r\n'
      + `sh.Run "powershell -STA -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""${ps1}"" -Seed ""${q(seed)}"" -Out ""${outPath}"" -PidFile ""${pidPath}""", 0, False\r\n`;
    const cleanup = () => { for (const f of [outPath, pidPath, vbsPath]) { try { fs.unlinkSync(f); } catch {} } };

    const ctrl = { pid: null, timer: null, settled: false };
    const finish = (val) => {
      if (ctrl.settled) return;
      ctrl.settled = true;
      clearInterval(ctrl.timer);
      cleanup();
      if (activePick === ctrl) activePick = null;
      resolve(val);
    };
    ctrl.cancel = () => {
      if (ctrl.settled) return;
      if (ctrl.pid) { try { spawnSync('taskkill', ['/F', '/PID', String(ctrl.pid)], { windowsHide: true }); } catch {} }
      finish(null);
    };
    activePick = ctrl;

    try { fs.writeFileSync(vbsPath, vbs, 'utf8'); }
    catch { finish(null); return; }
    const child = spawn('wscript', [vbsPath], { detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => finish(null));
    child.unref();

    // PID 파악 + 결과 파일 폴링(최대 3분). 결과 내용이 비면 취소로 간주.
    const startMs = Date.now();
    ctrl.timer = setInterval(() => {
      if (!ctrl.pid && fs.existsSync(pidPath)) {
        try { ctrl.pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10) || null; } catch {}
      }
      if (fs.existsSync(outPath)) {
        let val = null;
        try { val = fs.readFileSync(outPath, 'utf8').trim() || null; } catch {}
        finish(val);
      } else if (Date.now() - startMs > 180000) {
        finish(null);
      }
    }, 250);
  });
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
      const streamCmd = claudeSpawn(['-p', '--resume', effectiveId, '--output-format', 'stream-json', '--verbose'], CLEAN_ENV);
      const child = spawn(streamCmd.cmd, streamCmd.args, {
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
        behind: UPSTREAM ? count(`HEAD..${UPSTREAM}`) : 0,
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
      const args = buildMultiPaneArgs(items.map((it) => ({
        cwd: it.cwd, command: claudeCommandLine(`--resume ${it.sessionId}`),
      })));
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
    if (req.url === '/api/new-session-default') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      if (req.method === 'GET') {
        sendJson(res, 200, { folder: readDefaultFolder(loadConfigFresh()) });
        return;
      }
      if (req.method === 'POST') {
        let body;
        try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' }); return; }
        const folder = body && body.folder;
        if (!validCwd(res, folder)) return;
        saveDefaultFolder(folder);
        sendJson(res, 200, { ok: true, folder });
        return;
      }
    }
    if (req.method === 'POST' && req.url === '/api/pick-folder') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      let body = {};
      try { body = JSON.parse(await readBody(req)); } catch {}
      const seed = (body && body.seed) || readDefaultFolder(loadConfigFresh());
      const picked = await pickFolderDialog(seed);
      if (!picked) { sendJson(res, 200, { cancelled: true }); return; }
      sendJson(res, 200, { path: picked });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/new-session') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' }); return; }
      const { cwd, claude, mode } = body || {};
      if (!validCwd(res, cwd)) return;
      launchInTerminal(cwd, claude ? 'claude' : null, mode);
      sendJson(res, 200, { ok: true });
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
    if (req.method === 'GET' && req.url === '/api/catalog') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      // 목록만 즉시 반환. 설치 감지(claude mcp list 헬스체크가 느림)는 /api/installed로 분리.
      sendJson(res, 200, loadCatalog(__dirname));
      return;
    }
    if (req.method === 'GET' && req.url === '/api/installed') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      sendJson(res, 200, detectInstalled());
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/detect-env')) {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      const target = new URL(req.url, 'http://localhost').searchParams.get('target');
      const out = {};
      if (target === 'verse-diagnostics') {
        const logPath = uefnLogPath({ localAppData: process.env.LOCALAPPDATA, homedir: os.homedir() });
        const logFound = !!(logPath && fs.existsSync(logPath));
        out.UEFN_LOG_PATH = { value: logFound ? logPath : '', found: logFound };
        let root = '';
        if (logFound) {
          try { root = parseVerseProjectRoot(fs.readFileSync(logPath, 'utf8')) || ''; } catch {}
        }
        out.VERSE_PROJECT_ROOT = { value: root, found: !!root };
      }
      sendJson(res, 200, out);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/mcp-install') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' }); return; }
      const { items, scope, projectDir, mode } = body || {};
      if (!Array.isArray(items) || !items.length) { sendJson(res, 400, { error: '설치할 항목이 없습니다.' }); return; }
      const useScope = scope === 'project' ? 'project' : 'user';
      const cwd = useScope === 'project' ? projectDir : undefined;
      if (useScope === 'project' && !validCwd(res, cwd)) return;
      const cat = loadCatalog(__dirname);
      const byId = new Map(cat.mcp.map((m) => [m.id, m]));
      const results = [];
      const postInstall = []; // 설치만으로 끝나지 않는 항목(예: p4 login 티켓)은 터미널을 띄워 바로 이어서 하게 한다
      for (const it of items) {
        const entry = byId.get(it && it.id);
        if (!entry) { results.push({ id: it && it.id, ok: false, message: '카탈로그에 없는 항목' }); continue; }
        const argv = buildMcpAddArgs(entry, { scope: useScope, envValues: it.envValues || {}, headerValues: it.headerValues || {} });
        const r = runClaude(argv, { timeout: 120000, cwd });
        const ok = r.status === 0;
        const msg = ok ? '설치됨' : String((r.stderr || r.stdout || (r.error && r.error.message) || '실패')).trim().slice(0, 400);
        results.push({ id: entry.id, ok, message: msg, command: ok ? undefined : 'claude ' + argv.join(' ') });
        const post = ok && entry.postInstall && entry.postInstall.cmd;
        if (post) {
          launchInTerminal(cwd || os.homedir(), entry.postInstall.cmd, mode);
          postInstall.push({ id: entry.id, cmd: entry.postInstall.cmd, label: entry.postInstall.label || '' });
        }
      }
      sendJson(res, 200, { results, postInstall });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/mcp-fix') {
      // 설치 실패한 항목을 그 자리에서 claude에게 넘긴다 — 명령과 에러를 그대로 붙여 보낸다.
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' }); return; }
      const { failures, mode, projectDir } = body || {};
      if (!Array.isArray(failures) || !failures.length) { sendJson(res, 400, { error: '전달할 실패 항목이 없습니다.' }); return; }
      const byId = new Map(loadCatalog(__dirname).mcp.map((m) => [m.id, m]));
      const known = failures.filter((f) => f && byId.has(f.id))
        .map((f) => ({ id: f.id, name: byId.get(f.id).name, command: f.command, message: f.message }));
      if (!known.length) { sendJson(res, 400, { error: '카탈로그에 없는 항목입니다.' }); return; }
      const cwd = projectDir && fs.existsSync(projectDir) ? projectDir : os.homedir();
      const file = launchClaudeWithPrompt(cwd, buildInstallFixPrompt(known), mode, 'mcp-fix');
      sendJson(res, 200, { ok: true, handed: known.map((f) => f.id), promptFile: file });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/harness-install') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' }); return; }
      const { ids, mode } = body || {};
      if (!Array.isArray(ids) || !ids.length) { sendJson(res, 400, { error: '설치할 하네스가 없습니다.' }); return; }
      const cat = loadCatalog(__dirname);
      const byId = new Map(cat.harness.map((h) => [h.id, h]));
      const entries = ids.map((id) => byId.get(id)).filter(Boolean);
      if (!entries.length) { sendJson(res, 400, { error: '카탈로그에 없는 하네스입니다.' }); return; }
      const file = launchClaudeWithPrompt(os.homedir(), buildHarnessPrompt(entries), mode, 'harness');
      sendJson(res, 200, { ok: true, launched: entries.map((e) => e.id), promptFile: file });
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
