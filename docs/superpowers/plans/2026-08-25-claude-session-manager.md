# Claude 세션 매니저 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `~/.claude/projects/`의 세션 기록을 읽어 최근 작업 세션을 목록으로 보여주고, 클릭 한 번으로 해당 폴더에서 `claude --resume`을 실행하는 로컬 웹앱.

**Architecture:** 의존성 없는 단일 Node.js HTTP 서버(`server.js`)가 jsonl 파서(`lib/parse-session.js`)와 스캐너(`lib/scan-sessions.js`)를 사용해 `/api/sessions` JSON API를 제공하고, 바닐라 JS 단일 페이지(`index.html`)를 정적 서빙한다. resume은 서버가 Windows 터미널을 새로 띄워 처리한다.

**Tech Stack:** Node.js 24 내장 모듈만 사용 (`node:http`, `node:fs`, `node:path`, `node:os`, `node:child_process`, `node:test`). npm 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-08-25-claude-session-manager-design.md`

## Global Constraints

- npm 의존성 금지 — Node 내장 모듈만 사용.
- 포트: `7777`.
- 데이터 소스: `%USERPROFILE%\.claude\projects\<dir>\<sessionId>.jsonl`.
- 플랫폼: Windows (resume 터미널 실행은 `wt` 우선, 없으면 `cmd`).
- 테스트 러너: `node --test` (node:test 내장).
- 손상된 jsonl 줄은 건너뛰고 계속 파싱한다 (전체 실패 금지).
- 스펙과의 의도된 차이: 파일 읽기는 스트림 대신 `readFileSync` 후 줄 분리로 처리한다. 세션 파일은 수십 KB~수 MB 수준이라 메모리 문제가 없고 파서를 순수 동기 함수로 유지할 수 있다.

## 실제 jsonl 레코드 구조 (2026-08-25 실측)

한 줄에 JSON 객체 하나. 주요 레코드:

```json
{"type":"ai-title","aiTitle":"포트나이트 MCP 설정","sessionId":"c74acce5-..."}
{"type":"user","isSidechain":false,"message":{"role":"user","content":"프롬프트 텍스트"},"timestamp":"2026-08-24T05:23:31.539Z","cwd":"C:\\Users\\hunvr\\Desktop\\UEFN","gitBranch":"main","sessionId":"..."}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]},"timestamp":"...","cwd":"..."}
```

주의사항:
- `message.content`는 문자열 **또는** `[{type:"text",text:"..."}, ...]` 배열. tool 결과가 담긴 user 레코드는 content 배열에 `type:"tool_result"` 항목만 있어 텍스트가 없다 → 프롬프트로 취급하지 않는다.
- `isSidechain: true`인 user 레코드는 서브에이전트 대화이므로 프롬프트로 취급하지 않는다.
- `ai-title`, `mode`, `last-prompt` 등 메타 레코드에는 `timestamp`/`cwd`가 없을 수 있다.
- `timestamp`는 ISO 8601 문자열 → 문자열 비교로 min/max 산출 가능.

---

### Task 1: jsonl 세션 파서

**Files:**
- Create: `lib/parse-session.js`
- Test: `test/parse-session.test.js`

**Interfaces:**
- Consumes: 없음 (최초 태스크)
- Produces:
  - `parseSession(text: string) -> SessionMeta` — jsonl 전체 텍스트를 받아 메타데이터 객체 반환.
  - `SessionMeta = { sessionId: string|null, cwd: string|null, title: string|null, firstPrompt: string|null, lastPrompt: string|null, firstTimestamp: string|null, lastTimestamp: string|null, messageCount: number, gitBranch: string|null, empty: boolean }`
  - `extractText(content: string|Array|any) -> string` — message.content에서 사람이 읽는 텍스트 추출.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/parse-session.test.js`:

```js
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
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/parse-session.test.js`
Expected: FAIL — `Cannot find module '../lib/parse-session'`

- [ ] **Step 3: 최소 구현 작성**

`lib/parse-session.js`:

```js
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
    if (rec.type === 'user' && rec.isSidechain !== true && rec.message) {
      const prompt = extractText(rec.message.content).trim();
      if (prompt) {
        if (!result.firstPrompt) result.firstPrompt = prompt;
        result.lastPrompt = prompt;
        result.empty = false;
      }
    }
  }
  if (!result.title && result.firstPrompt) result.title = result.firstPrompt.slice(0, 80);
  return result;
}

module.exports = { parseSession, extractText };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/parse-session.test.js`
Expected: PASS — 6 tests pass

- [ ] **Step 5: 커밋**

```bash
git add lib/parse-session.js test/parse-session.test.js
git commit -m "feat: add jsonl session parser"
```

---

### Task 2: 세션 스캐너 (mtime 캐시 포함)

**Files:**
- Create: `lib/scan-sessions.js`
- Test: `test/scan-sessions.test.js`

**Interfaces:**
- Consumes: Task 1의 `parseSession(text)` (`require('./parse-session')`)
- Produces:
  - `scanSessions(rootDir: string, cache: Map) -> SessionMeta[]` — rootDir 아래 모든 프로젝트 폴더의 `*.jsonl`을 파싱해 마지막 활동 시각 내림차순 배열 반환. 각 항목은 Task 1의 `SessionMeta`에 `sessionId`(레코드에 없으면 파일명에서), `projectDir`(폴더명) 필드가 보장됨.
  - `cache`는 `Map<filePath, { mtimeMs, data }>`. 같은 mtime이면 재파싱하지 않음. 호출자가 Map을 유지·재사용한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`test/scan-sessions.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSessions } = require('../lib/scan-sessions');

const line = (obj) => JSON.stringify(obj);

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csm-test-'));
  const dirA = path.join(root, 'C--work-projA');
  const dirB = path.join(root, 'C--work-projB');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  fs.writeFileSync(
    path.join(dirA, 'aaaa-1111.jsonl'),
    line({ type: 'user', message: { role: 'user', content: '오래된 세션' }, timestamp: '2026-08-01T00:00:00.000Z', cwd: 'C:\\work\\projA' }),
  );
  fs.writeFileSync(
    path.join(dirB, 'bbbb-2222.jsonl'),
    line({ type: 'user', message: { role: 'user', content: '최근 세션' }, timestamp: '2026-08-20T00:00:00.000Z', cwd: 'C:\\work\\projB' }),
  );
  fs.writeFileSync(path.join(dirB, 'not-a-session.txt'), 'ignore me');
  return root;
}

test('모든 프로젝트 폴더를 스캔해 마지막 활동순으로 정렬한다', () => {
  const root = makeFixture();
  const sessions = scanSessions(root, new Map());
  assert.strictEqual(sessions.length, 2);
  assert.strictEqual(sessions[0].firstPrompt, '최근 세션');
  assert.strictEqual(sessions[1].firstPrompt, '오래된 세션');
  fs.rmSync(root, { recursive: true, force: true });
});

test('레코드에 sessionId가 없으면 파일명을 사용하고 projectDir를 채운다', () => {
  const root = makeFixture();
  const sessions = scanSessions(root, new Map());
  const recent = sessions[0];
  assert.strictEqual(recent.sessionId, 'bbbb-2222');
  assert.strictEqual(recent.projectDir, 'C--work-projB');
  fs.rmSync(root, { recursive: true, force: true });
});

test('mtime이 같으면 캐시를 사용하고, 파일이 바뀌면 재파싱한다', () => {
  const root = makeFixture();
  const cache = new Map();
  scanSessions(root, cache);
  const filePath = path.join(root, 'C--work-projB', 'bbbb-2222.jsonl');
  // 캐시 데이터를 오염시켜 캐시 히트 여부를 관찰한다
  cache.get(filePath).data.title = 'CACHED';
  let sessions = scanSessions(root, cache);
  assert.strictEqual(sessions[0].title, 'CACHED');
  // 파일을 수정하고 mtime을 미래로 바꾸면 재파싱된다
  fs.writeFileSync(filePath, line({ type: 'user', message: { role: 'user', content: '수정된 세션' }, timestamp: '2026-08-21T00:00:00.000Z' }));
  fs.utimesSync(filePath, new Date(), new Date(Date.now() + 10000));
  sessions = scanSessions(root, cache);
  assert.strictEqual(sessions[0].firstPrompt, '수정된 세션');
  fs.rmSync(root, { recursive: true, force: true });
});

test('rootDir가 없으면 빈 배열을 반환한다', () => {
  const sessions = scanSessions(path.join(os.tmpdir(), 'csm-does-not-exist'), new Map());
  assert.deepStrictEqual(sessions, []);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `node --test test/scan-sessions.test.js`
Expected: FAIL — `Cannot find module '../lib/scan-sessions'`

- [ ] **Step 3: 최소 구현 작성**

`lib/scan-sessions.js`:

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseSession } = require('./parse-session');

function scanSessions(rootDir, cache = new Map()) {
  const sessions = [];
  let projectDirs;
  try {
    projectDirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory());
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
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/scan-sessions.test.js`
Expected: PASS — 4 tests pass. 이어서 `node --test test/` 전체 실행: 10 tests pass.

- [ ] **Step 5: 커밋**

```bash
git add lib/scan-sessions.js test/scan-sessions.test.js
git commit -m "feat: add session scanner with mtime cache"
```

---

### Task 3: HTTP 서버 (`/api/sessions`, `/api/resume`, 정적 서빙)

**Files:**
- Create: `server.js`

**Interfaces:**
- Consumes: Task 2의 `scanSessions(rootDir, cache)` (`require('./lib/scan-sessions')`)
- Produces:
  - `GET /` → `index.html` 서빙 (Task 4가 이 파일을 만든다; 그전에는 404가 정상)
  - `GET /api/sessions` → `SessionMeta[]` JSON (200)
  - `POST /api/resume` body `{ "sessionId": "...", "cwd": "..." }` → 성공 시 `{ "ok": true }` (200). `cwd` 없거나 폴더 미존재 시 `{ "error": "..." }` (400). sessionId 형식 불일치 시 400.

서버는 OS 프로세스 실행·HTTP 배선이 전부라 단위 테스트 대신 curl로 수동 검증한다 (스펙의 테스트 절과 일치).

- [ ] **Step 1: 구현 작성**

`server.js`:

```js
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const { scanSessions } = require('./lib/scan-sessions');

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
    if (req.method === 'POST' && req.url === '/api/resume') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' });
        return;
      }
      const { sessionId, cwd } = body || {};
      if (!SESSION_ID_RE.test(String(sessionId || ''))) {
        sendJson(res, 400, { error: '세션 ID 형식이 올바르지 않습니다.' });
        return;
      }
      if (!cwd || !fs.existsSync(cwd)) {
        sendJson(res, 400, { error: `작업 폴더가 존재하지 않습니다: ${cwd || '(없음)'}` });
        return;
      }
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
```

- [ ] **Step 2: 수동 검증 — API**

```powershell
node server.js   # 별도 창 또는 백그라운드에서 실행
curl.exe -s http://localhost:7777/api/sessions | Select-Object -First 1
```

Expected: 세션 객체 배열 JSON 출력. 첫 항목이 가장 최근 세션(`lastTimestamp` 최대).

```powershell
curl.exe -s -X POST http://localhost:7777/api/resume -H "Content-Type: application/json" -d '{\"sessionId\":\"zzz!!\",\"cwd\":\"C:\\\\\"}'
```

Expected: `{"error":"세션 ID 형식이 올바르지 않습니다."}` (400)

```powershell
curl.exe -s -X POST http://localhost:7777/api/resume -H "Content-Type: application/json" -d '{\"sessionId\":\"abcd1234-0000-0000-0000-000000000000\",\"cwd\":\"C:\\\\no-such-dir\"}'
```

Expected: `{"error":"작업 폴더가 존재하지 않습니다: C:\\no-such-dir"}` (400)

실제 resume 동작은 Task 4 완료 후 UI에서 실세션으로 확인한다.

- [ ] **Step 3: 커밋**

```bash
git add server.js
git commit -m "feat: add http server with sessions and resume endpoints"
```

---

### Task 4: UI (`index.html`)

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: Task 3의 `GET /api/sessions`, `POST /api/resume`
- Produces: 사용자 UI (다른 태스크가 의존하지 않음)

- [ ] **Step 1: 구현 작성**

`index.html`:

```html
<meta charset="utf-8">
<title>Claude 세션 매니저</title>
<style>
  :root { --bg: #f6f7f9; --panel: #fff; --border: #e2e5ea; --text: #1c2128; --muted: #6b7280; --accent: #c96442; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', 'Malgun Gothic', sans-serif; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
  header { padding: 14px 20px; background: var(--panel); border-bottom: 1px solid var(--border); display: flex; gap: 16px; align-items: center; }
  header h1 { font-size: 16px; margin: 0; }
  #search { flex: 1; max-width: 480px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 14px; }
  header label { font-size: 13px; color: var(--muted); display: flex; gap: 6px; align-items: center; }
  main { flex: 1; display: flex; min-height: 0; }
  #list { flex: 1; overflow-y: auto; padding: 12px; }
  .row { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; margin-bottom: 8px; cursor: pointer; }
  .row:hover { border-color: var(--accent); }
  .row.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .row .title { font-weight: 600; font-size: 14px; margin-bottom: 4px; }
  .row .meta { font-size: 12px; color: var(--muted); display: flex; gap: 12px; flex-wrap: wrap; }
  #detail { width: 40%; min-width: 320px; max-width: 560px; background: var(--panel); border-left: 1px solid var(--border); padding: 20px; overflow-y: auto; display: none; }
  #detail.open { display: block; }
  #detail h2 { font-size: 15px; margin: 0 0 12px; }
  #detail dl { font-size: 13px; }
  #detail dt { color: var(--muted); margin-top: 10px; }
  #detail dd { margin: 2px 0 0; word-break: break-all; white-space: pre-wrap; }
  #resumeBtn { margin-top: 16px; width: 100%; padding: 10px; background: var(--accent); color: #fff; border: 0; border-radius: 8px; font-size: 14px; cursor: pointer; }
  #resumeBtn:disabled { opacity: .5; cursor: default; }
  #status { margin-top: 8px; font-size: 13px; color: var(--muted); min-height: 18px; }
  #empty-msg { color: var(--muted); text-align: center; margin-top: 40px; }
</style>
<header>
  <h1>Claude 세션 매니저</h1>
  <input id="search" type="search" placeholder="제목·프롬프트 검색...">
  <label><input id="showEmpty" type="checkbox"> 빈 세션 표시</label>
</header>
<main>
  <div id="list"></div>
  <aside id="detail"></aside>
</main>
<script>
'use strict';
let sessions = [];
let selected = null;
const $list = document.getElementById('list');
const $detail = document.getElementById('detail');
const $search = document.getElementById('search');
const $showEmpty = document.getElementById('showEmpty');

function relTime(iso) {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return m + '분 전';
  const h = Math.floor(m / 60);
  if (h < 24) return h + '시간 전';
  const d = Math.floor(h / 24);
  if (d < 30) return d + '일 전';
  return new Date(iso).toLocaleDateString('ko-KR');
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

function visible() {
  const q = $search.value.trim().toLowerCase();
  return sessions.filter((s) => {
    if (s.empty && !$showEmpty.checked) return false;
    if (!q) return true;
    return [s.title, s.firstPrompt, s.lastPrompt, s.cwd]
      .some((f) => f && f.toLowerCase().includes(q));
  });
}

function renderList() {
  const items = visible();
  if (!items.length) {
    $list.innerHTML = '<p id="empty-msg">표시할 세션이 없습니다.</p>';
    return;
  }
  $list.innerHTML = items.map((s) => `
    <div class="row${selected === s.sessionId ? ' active' : ''}" data-id="${esc(s.sessionId)}">
      <div class="title">${esc(s.title || '(제목 없음)')}</div>
      <div class="meta">
        <span>📁 ${esc(s.cwd || '(경로 없음)')}</span>
        <span>🕒 ${relTime(s.lastTimestamp)}</span>
        <span>💬 ${s.messageCount}</span>
      </div>
    </div>`).join('');
}

function renderDetail() {
  const s = sessions.find((x) => x.sessionId === selected);
  if (!s) { $detail.classList.remove('open'); return; }
  const durMs = s.firstTimestamp && s.lastTimestamp ? new Date(s.lastTimestamp) - new Date(s.firstTimestamp) : 0;
  const durMin = Math.round(durMs / 60000);
  $detail.classList.add('open');
  $detail.innerHTML = `
    <h2>${esc(s.title || '(제목 없음)')}</h2>
    <dl>
      <dt>작업 폴더</dt><dd>${esc(s.cwd || '-')}</dd>
      <dt>마지막 활동</dt><dd>${relTime(s.lastTimestamp)} (${esc(s.lastTimestamp || '-')})</dd>
      <dt>작업 시간</dt><dd>약 ${durMin}분 · 메시지 ${s.messageCount}개</dd>
      <dt>git 브랜치</dt><dd>${esc(s.gitBranch || '-')}</dd>
      <dt>첫 프롬프트</dt><dd>${esc((s.firstPrompt || '-').slice(0, 1000))}</dd>
      <dt>마지막 프롬프트</dt><dd>${esc((s.lastPrompt || '-').slice(0, 1000))}</dd>
      <dt>세션 ID</dt><dd>${esc(s.sessionId)}</dd>
    </dl>
    <button id="resumeBtn"${s.cwd ? '' : ' disabled'}>▶ 이어서 작업</button>
    <div id="status"></div>`;
  document.getElementById('resumeBtn').onclick = () => resume(s);
}

async function resume(s) {
  const $status = document.getElementById('status');
  $status.textContent = '터미널 실행 중...';
  try {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: s.sessionId, cwd: s.cwd }),
    });
    const body = await res.json();
    $status.textContent = res.ok ? '터미널을 열었습니다.' : '실패: ' + body.error;
  } catch (err) {
    $status.textContent = '실패: ' + err.message;
  }
}

async function load() {
  const res = await fetch('/api/sessions');
  sessions = await res.json();
  renderList();
  renderDetail();
}

$list.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  selected = row.dataset.id;
  renderList();
  renderDetail();
});
$search.addEventListener('input', renderList);
$showEmpty.addEventListener('change', renderList);
load();
</script>
```

- [ ] **Step 2: 수동 검증 — UI 전체 흐름**

1. `node server.js` 실행 → 브라우저에서 `http://localhost:7777` 접속.
2. 세션 목록이 최근 활동순으로 표시되고, 각 행에 제목·실제 폴더 경로·상대 시간·메시지 수가 보이는지 확인.
3. 검색창에 키워드 입력 → 제목/프롬프트 기준으로 목록이 즉시 필터되는지 확인.
4. "빈 세션 표시" 체크 → 숨겨졌던 빈 세션이 나타나는지 확인.
5. 세션 클릭 → 우측 상세 패널에 첫/마지막 프롬프트, 기간, 브랜치, 세션 ID 표시 확인.
6. **[▶ 이어서 작업]** 클릭 → 새 터미널 창이 해당 폴더에서 열리고 `claude --resume`으로 그 세션이 이어지는지 확인.

- [ ] **Step 3: 커밋**

```bash
git add index.html
git commit -m "feat: add session list UI with search, detail panel, and resume"
```

---

### Task 5: README 및 마무리

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 전체 태스크 결과물
- Produces: 사용 문서

- [ ] **Step 1: README 작성**

`README.md`:

```markdown
# Claude 세션 매니저

`~/.claude/projects/`의 Claude Code 세션 기록을 읽어 최근 작업 세션을
한눈에 보여주고, 클릭 한 번으로 해당 폴더에서 이어서 작업할 수 있는
로컬 웹앱입니다. npm 의존성이 없습니다.

## 실행

```
node server.js
```

브라우저에서 http://localhost:7777 접속.

## 기능

- 최근 활동순 세션 목록 (제목, 실제 작업 폴더, 마지막 활동, 메시지 수)
- 제목·프롬프트 내용 검색
- 세션 상세 (첫/마지막 프롬프트, 작업 시간, git 브랜치)
- [이어서 작업] — 해당 폴더에서 새 터미널로 `claude --resume` 실행
- 빈 세션 숨김/표시 토글

## 테스트

```
node --test test/
```
```

- [ ] **Step 2: 전체 테스트 최종 확인**

Run: `node --test test/`
Expected: PASS — 10 tests pass

- [ ] **Step 3: 커밋**

```bash
git add README.md
git commit -m "docs: add README"
```
