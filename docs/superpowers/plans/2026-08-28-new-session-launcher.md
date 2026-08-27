# 새 세션 시작 (임의 폴더 + 선택적 claude) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱 헤더의 `+ 새 세션` 버튼으로, 사용자가 정한 기본 폴더(또는 그때 고른 폴더)에서 새 터미널을 열고 선택적으로 claude를 바로 실행한다.

**Architecture:** 순수 로직(런치 인자 구성 + config 머지)을 `lib/new-session.js`로 분리해 `node --test`로 검증한다. `server.js`는 기존 `launchInTerminal`을 이 로직에 위임하도록 리팩터해 resume/fresh/새세션이 한 경로를 공유하고, 폴더 선택(PowerShell 다이얼로그)·기본폴더 저장(config.json 머지+백업)·새세션 실행 라우트를 추가한다. `index.html`은 기존 헤더버튼→오버레이 패턴으로 패널 UI를 붙인다.

**Tech Stack:** Node.js(내장 모듈만, 의존성 없음), `node:test`, Windows Terminal(`wt`)/`cmd`, PowerShell(`FolderBrowserDialog`), 바닐라 HTML/JS + localStorage.

**참고 스펙:** `docs/superpowers/specs/2026-08-28-new-session-launcher-design.md`

---

## File Structure

- **Create** `lib/new-session.js` — 순수 함수 3개: `buildLaunchArgs`(런치 cmd/args 구성), `readDefaultFolder`(config→기본폴더, 홈 폴백), `withDefaultFolder`(config에 기본폴더 머지). `OPEN_MODES`/`normalizeMode`의 단일 출처.
- **Create** `test/new-session.test.js` — 위 함수들의 단위 테스트.
- **Modify** `server.js` — (1) `lib/new-session`에서 `buildLaunchArgs`·`OPEN_MODES` import, 로컬 `OPEN_MODES`/`normalizeMode` 제거, `launchInTerminal`을 `buildLaunchArgs`에 위임(빈 명령 지원). (2) config.json 프레시 읽기/백업 저장 헬퍼. (3) 라우트 3개: `/api/new-session-default`(GET/POST), `/api/pick-folder`(POST), `/api/new-session`(POST).
- **Modify** `index.html` — 헤더에 accent `+ 새 세션` 버튼 + 오버레이 패널(마크업/스타일) + JS 배선.

---

## Task 1: lib/new-session.js — config 헬퍼 (기본 폴더 읽기/머지)

**Files:**
- Create: `lib/new-session.js`
- Test: `test/new-session.test.js`

- [ ] **Step 1: 실패하는 테스트 작성**

Create `test/new-session.test.js`:

```javascript
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const { readDefaultFolder, withDefaultFolder } = require('../lib/new-session');

test('기본 폴더가 없으면 홈 폴더로 폴백한다', () => {
  assert.strictEqual(readDefaultFolder({}), os.homedir());
  assert.strictEqual(readDefaultFolder(null), os.homedir());
  assert.strictEqual(readDefaultFolder({ newSession: {} }), os.homedir());
});

test('설정된 기본 폴더를 그대로 반환한다', () => {
  const cfg = { newSession: { defaultFolder: 'C:/work/proj' } };
  assert.strictEqual(readDefaultFolder(cfg), 'C:/work/proj');
});

test('withDefaultFolder는 기존 remote 키를 보존하며 기본 폴더만 넣는다', () => {
  const cfg = { remote: { enabled: true, key: 'secret', name: 'PC1' } };
  const next = withDefaultFolder(cfg, 'C:/work/proj');
  assert.deepStrictEqual(next.remote, { enabled: true, key: 'secret', name: 'PC1' });
  assert.strictEqual(next.newSession.defaultFolder, 'C:/work/proj');
  // 원본 불변
  assert.strictEqual(cfg.newSession, undefined);
});

test('withDefaultFolder는 기존 newSession의 다른 키를 보존한다', () => {
  const cfg = { newSession: { defaultFolder: 'C:/old', other: 1 } };
  const next = withDefaultFolder(cfg, 'C:/new');
  assert.strictEqual(next.newSession.defaultFolder, 'C:/new');
  assert.strictEqual(next.newSession.other, 1);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/new-session.test.js`
Expected: FAIL — `Cannot find module '../lib/new-session'`

- [ ] **Step 3: 최소 구현 작성**

Create `lib/new-session.js`:

```javascript
'use strict';
const os = require('node:os');

// config.json → 기본 폴더. 없으면 홈 폴더(%USERPROFILE%)로 폴백.
function readDefaultFolder(config) {
  const f = config && config.newSession && config.newSession.defaultFolder;
  return f || os.homedir();
}

// config 객체에 기본 폴더를 머지한 새 객체 반환(원본 불변, 다른 키 보존).
function withDefaultFolder(config, folder) {
  const base = config || {};
  return {
    ...base,
    newSession: { ...(base.newSession || {}), defaultFolder: folder },
  };
}

module.exports = { readDefaultFolder, withDefaultFolder };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/new-session.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/new-session.js test/new-session.test.js
git commit -m "feat: new-session config 헬퍼(기본 폴더 읽기/머지)"
```

---

## Task 2: lib/new-session.js — buildLaunchArgs (런치 인자 구성)

**Files:**
- Modify: `lib/new-session.js`
- Test: `test/new-session.test.js`

- [ ] **Step 1: 실패하는 테스트 추가**

Append to `test/new-session.test.js`:

```javascript
const { buildLaunchArgs } = require('../lib/new-session');

test('wt: 명령이 있으면 -d cwd 뒤에 cmd /k <명령>을 붙인다', () => {
  const { cmd, args } = buildLaunchArgs({ cwd: 'C:/w', command: 'claude', mode: 'window', hasWt: true });
  assert.strictEqual(cmd, 'wt');
  assert.deepStrictEqual(args, ['-w', 'new', 'nt', '-d', 'C:/w', 'cmd', '/k', 'claude']);
});

test('wt: 명령이 없으면 -d cwd 로 셸만 연다', () => {
  const { cmd, args } = buildLaunchArgs({ cwd: 'C:/w', command: null, mode: 'tab', hasWt: true });
  assert.strictEqual(cmd, 'wt');
  assert.deepStrictEqual(args, ['-w', '0', 'nt', '-d', 'C:/w']);
});

test('mode가 잘못되면 tab으로 정규화한다', () => {
  const { args } = buildLaunchArgs({ cwd: 'C:/w', command: null, mode: 'nope', hasWt: true });
  assert.deepStrictEqual(args, ['-w', '0', 'nt', '-d', 'C:/w']);
});

test('wt 없음: 명령이 있으면 start로 새 창을 열고 cd 후 명령 실행', () => {
  const { cmd, args } = buildLaunchArgs({ cwd: 'C:/w', command: 'claude', mode: 'tab', hasWt: false });
  assert.strictEqual(cmd, 'cmd');
  assert.deepStrictEqual(args, ['/c', 'start', '"claude"', 'cmd', '/k', 'cd /d "C:/w" && claude']);
});

test('wt 없음: 명령이 없으면 cd만 하고 셸을 남긴다', () => {
  const { args } = buildLaunchArgs({ cwd: 'C:/w', command: null, mode: 'tab', hasWt: false });
  assert.strictEqual(args[args.length - 1], 'cd /d "C:/w"');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/new-session.test.js`
Expected: FAIL — `buildLaunchArgs is not a function`

- [ ] **Step 3: 최소 구현 작성**

Edit `lib/new-session.js` — 상단(‘use strict’ 아래)에 추가:

```javascript
// 열기 방식 → wt 인자. server.js의 단일 출처.
const OPEN_MODES = {
  window: ['-w', 'new', 'nt'],
  tab: ['-w', '0', 'nt'],
  'split-right': ['-w', '0', 'sp', '-V'],
  'split-down': ['-w', '0', 'sp', '-H'],
};

function normalizeMode(mode) {
  return OPEN_MODES[mode] ? mode : 'tab';
}

// 터미널 실행 cmd/args 구성(순수). command가 falsy면 셸만 연다.
// resume은 command='claude --resume <id>', 새세션 claude on은 'claude', off는 null.
function buildLaunchArgs({ cwd, command, mode, hasWt }) {
  const openArgs = OPEN_MODES[normalizeMode(mode)];
  if (hasWt) {
    const base = [...openArgs, '-d', cwd];
    return { cmd: 'wt', args: command ? [...base, 'cmd', '/k', command] : base };
  }
  const shellCmd = command ? `cd /d "${cwd}" && ${command}` : `cd /d "${cwd}"`;
  return { cmd: 'cmd', args: ['/c', 'start', '"claude"', 'cmd', '/k', shellCmd] };
}
```

그리고 `module.exports`를 교체:

```javascript
module.exports = { readDefaultFolder, withDefaultFolder, buildLaunchArgs, OPEN_MODES, normalizeMode };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/new-session.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add lib/new-session.js test/new-session.test.js
git commit -m "feat: buildLaunchArgs로 터미널 런치 인자 구성 일원화"
```

---

## Task 3: server.js — launchInTerminal을 buildLaunchArgs에 위임

기존 `launchInTerminal`/`OPEN_MODES`/`normalizeMode`를 lib로 위임해 중복을 없애고 "빈 명령(셸만)"을 지원한다. resume/fresh 호출부는 이미 `(cwd, 명령문자열, mode)` 형태라 그대로 동작한다.

**Files:**
- Modify: `server.js:8`(require 추가), `server.js:185-210`(OPEN_MODES/normalizeMode/launchInTerminal)

- [ ] **Step 1: lib import 추가**

`server.js:10` 부근(다른 lib require 옆)에 추가:

```javascript
const { buildLaunchArgs, readDefaultFolder, withDefaultFolder } = require('./lib/new-session');
```

- [ ] **Step 2: 로컬 OPEN_MODES/normalizeMode 제거 + launchInTerminal 교체**

`server.js`의 아래 블록(주석 `// 열기 방식: ...`부터 `launchInTerminal` 끝까지, 대략 185-210행)을 다음으로 **교체**:

```javascript
// 열기 방식(window/tab/split-right/split-down)과 런치 인자는 lib/new-session이 단일 출처.
function launchInTerminal(cwd, command, mode) {
  const { cmd, args } = buildLaunchArgs({ cwd, command, mode, hasWt });
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env: CLEAN_ENV });
  child.unref();
}
```

> 주의: 기존 `launchResume`, `launchFreshClaude`는 그대로 두고 이 함수만 교체한다. 두 함수 모두 `launchInTerminal(cwd, <명령문자열>, mode)`를 호출하므로 시그니처가 호환된다. (비-wt 경로에도 `CLEAN_ENV`를 적용 — "모든 자식 프로세스에서 CLAUDE_CODE_* 제거" 커밋 의도와 일치.)

- [ ] **Step 3: 회귀 확인 — 기존/신규 테스트 전부 통과**

Run: `node --test`
Expected: PASS (기존 테스트 + new-session 9개 모두 통과)

- [ ] **Step 4: 수동 스모크 — resume이 여전히 열리는지 확인**

Run: `node server.js` 실행 → 브라우저 http://localhost:7777 → 아무 세션 [이어서 작업] 클릭 → 터미널이 해당 폴더에서 `claude --resume`으로 열리는지 확인. 확인 후 서버 종료(브라우저 탭 닫기).

- [ ] **Step 5: 커밋**

```bash
git add server.js
git commit -m "refactor: launchInTerminal을 buildLaunchArgs에 위임(빈 명령 지원)"
```

---

## Task 4: server.js — 기본 폴더 GET/POST 라우트 (config.json 머지+백업)

**Files:**
- Modify: `server.js`(헬퍼 추가 + 라우트 추가, `/api/resume` 라우트 앞)

- [ ] **Step 1: config 프레시 읽기/저장 헬퍼 추가**

`server.js`의 `validCwd` 함수(약 226-232행) 바로 아래에 추가:

```javascript
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
```

- [ ] **Step 2: 라우트 추가**

`server.js`의 `if (req.method === 'POST' && (req.url === '/api/resume' ...` 라우트(약 822행) **바로 앞**에 추가:

```javascript
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
```

- [ ] **Step 3: 수동 검증 — GET/POST 동작**

Run: `node server.js` 실행 후 다른 터미널에서:

```bash
curl http://localhost:7777/api/new-session-default
```
Expected: `{"folder":"C:\\Users\\..."}` (기본 폴더 없으면 홈 폴더)

```bash
curl -X POST http://localhost:7777/api/new-session-default -H "Content-Type: application/json" -d "{\"folder\":\"C:/Users/ACE/Desktop\"}"
```
Expected: `{"ok":true,"folder":"C:/Users/ACE/Desktop"}` → `config.json`에 `newSession.defaultFolder`가 생기고, 기존 `config.json`이 있었으면 `config.json.csm-backup`이 생성됨. 다시 GET 하면 방금 저장한 폴더가 나온다.

- [ ] **Step 4: 커밋**

```bash
git add server.js
git commit -m "feat: 기본 폴더 GET/POST 라우트(config.json 머지+백업)"
```

---

## Task 5: server.js — 폴더 선택 다이얼로그 라우트 (/api/pick-folder)

PowerShell `FolderBrowserDialog`를 비동기로 띄우고(이벤트 루프 블로킹 방지) 고른 경로를 반환한다.

**Files:**
- Modify: `server.js`(헬퍼 + 라우트)

- [ ] **Step 1: 폴더 선택 헬퍼 추가**

`server.js`의 `saveDefaultFolder` 함수 아래에 추가:

```javascript
// 네이티브 폴더 선택창(PowerShell)을 띄우고 고른 경로를 resolve. 취소 시 null.
function pickFolderDialog(seed) {
  return new Promise((resolve) => {
    const safeSeed = String(seed || '').replace(/'/g, "''");
    const script =
      "Add-Type -AssemblyName System.Windows.Forms;" +
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog;" +
      "$d.ShowNewFolderButton = $true;" +
      "try { $d.SelectedPath = '" + safeSeed + "' } catch {};" +
      "if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }";
    const ps = spawn('powershell', ['-STA', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('error', () => resolve(null));
    ps.on('close', () => resolve(out.trim() || null));
  });
}
```

- [ ] **Step 2: 라우트 추가**

Task 4에서 추가한 블록 아래(여전히 `/api/resume` 라우트 앞)에 추가:

```javascript
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
```

- [ ] **Step 3: 수동 검증 — 다이얼로그가 뜨고 경로를 반환**

Run: `node server.js` → 다른 터미널에서:

```bash
curl -X POST http://localhost:7777/api/pick-folder -H "Content-Type: application/json" -d "{}"
```
Expected: 폴더 선택창이 뜬다 → 폴더 고르면 `{"path":"..."}`, 취소하면 `{"cancelled":true}`.

- [ ] **Step 4: 커밋**

```bash
git add server.js
git commit -m "feat: 네이티브 폴더 선택 다이얼로그 라우트(/api/pick-folder)"
```

---

## Task 6: server.js — 새 세션 실행 라우트 (/api/new-session)

**Files:**
- Modify: `server.js`(라우트)

- [ ] **Step 1: 라우트 추가**

Task 5에서 추가한 블록 아래(`/api/resume` 라우트 앞)에 추가:

```javascript
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
```

- [ ] **Step 2: 수동 검증 — claude on/off 둘 다**

Run: `node server.js` → 다른 터미널에서:

```bash
curl -X POST http://localhost:7777/api/new-session -H "Content-Type: application/json" -d "{\"cwd\":\"C:/Users/ACE/Desktop\",\"claude\":true,\"mode\":\"window\"}"
```
Expected: 새 터미널 창이 그 폴더에서 열리고 `claude`가 실행됨.

```bash
curl -X POST http://localhost:7777/api/new-session -H "Content-Type: application/json" -d "{\"cwd\":\"C:/Users/ACE/Desktop\",\"claude\":false,\"mode\":\"window\"}"
```
Expected: 새 터미널 창이 그 폴더에서 셸만(claude 없이) 열림.

- [ ] **Step 3: 커밋**

```bash
git add server.js
git commit -m "feat: 새 세션 실행 라우트(/api/new-session)"
```

---

## Task 7: index.html — 헤더 버튼 + 오버레이 패널 (마크업/스타일)

기존 `kbBtn`→`kbOverlay` 패턴을 따른다.

**Files:**
- Modify: `index.html`(헤더 약 184행, 스타일 약 138행 부근, 오버레이 마크업 약 274행 부근)

- [ ] **Step 1: 헤더에 accent 버튼 추가**

`index.html`의 `<button id="kbBtn">...` **바로 앞**(약 184행)에 추가:

```html
  <button id="newSessionBtn" class="primary"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> 새 세션</button>
  <span class="hdr-sep" aria-hidden="true"></span>
```

- [ ] **Step 2: 스타일 추가**

`index.html`의 `#kbOverlay { ... }` 스타일(약 138행) **바로 앞**에 추가:

```css
  #newSessionBtn { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 8px 12px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent); color: #fff; font-size: 15px; cursor: pointer; }
  #newSessionBtn:hover { background: #b55536; border-color: #b55536; }
  .hdr-sep { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--border); }
  #nsOverlay { display: none; position: fixed; inset: 0; background: rgba(28,33,40,.4); z-index: 10; }
  #nsOverlay.open { display: flex; align-items: center; justify-content: center; }
  #nsPanel { background: var(--panel); border-radius: 12px; padding: 24px; width: 460px; max-width: calc(100vw - 24px); box-shadow: 0 12px 32px rgba(28,33,40,.18); }
  #nsPanel h2 { font-size: 19px; margin: 0 0 6px; }
  #nsHint { font-size: 13px; color: var(--muted); margin: 0 0 16px; line-height: 1.5; }
  #nsFolderRow { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
  #nsFolder { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #nsPanel .ns-btn { min-height: 38px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); font-size: 13px; color: var(--text); cursor: pointer; white-space: nowrap; }
  #nsPanel .ns-btn:hover { border-color: var(--accent); color: var(--accent); }
  #nsClaudeRow { display: flex; align-items: center; gap: 8px; font-size: 14px; margin-bottom: 20px; }
  #nsActions { display: flex; gap: 8px; }
  #nsOpen { flex: 1; min-height: 44px; background: var(--accent); color: #fff; border: 0; border-radius: 8px; font-size: 15px; cursor: pointer; }
  #nsCancel { min-height: 44px; padding: 0 16px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; font-size: 15px; color: var(--text); cursor: pointer; }
```

- [ ] **Step 3: 오버레이 패널 마크업 추가**

`index.html`의 `<div id="kbOverlay">` **바로 앞**(약 274행)에 추가:

```html
<div id="nsOverlay">
  <div id="nsPanel" role="dialog" aria-modal="true" aria-labelledby="nsTitle">
    <h2 id="nsTitle">새 세션 시작</h2>
    <p id="nsHint">📍 <strong>여기서 AI가 작업합니다.</strong> 폴더를 정해두면 claude가 그 자리에서 바로 시작해요 — "어디서 작업할까요" 왕복 없이 첫 프롬프트부터 본론으로.</p>
    <div id="nsFolderRow">
      <span id="nsFolder" title=""></span>
      <button type="button" class="ns-btn" id="nsPick">폴더 선택…</button>
      <button type="button" class="ns-btn" id="nsSetDefault">기본으로 설정</button>
    </div>
    <label id="nsClaudeRow"><input type="checkbox" id="nsClaude"> claude 자동 실행</label>
    <div id="nsActions">
      <button id="nsOpen">열기</button>
      <button id="nsCancel">취소</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: 렌더 확인**

Run: `node server.js` → 브라우저 새로고침 → 헤더 왼쪽에 주황 `+ 새 세션` 버튼과 구분선이 보이는지 확인(아직 클릭 동작은 없음).

- [ ] **Step 5: 커밋**

```bash
git add index.html
git commit -m "feat: 새 세션 헤더 버튼 + 오버레이 패널 마크업/스타일"
```

---

## Task 8: index.html — 새 세션 패널 JS 배선

**Files:**
- Modify: `index.html`(스크립트 하단, `getOpenMode` 함수 부근 약 852행 뒤)

- [ ] **Step 1: 배선 코드 추가**

`index.html`의 `getOpenMode` 함수 정의(약 849-852행) **바로 뒤**에 추가:

```javascript
// ---- 새 세션 패널 ----
const $nsOverlay = document.getElementById('nsOverlay');
const $nsFolder = document.getElementById('nsFolder');
const $nsClaude = document.getElementById('nsClaude');
const $nsStatus = document.getElementById('status');

function setNsFolder(path) {
  $nsFolder.textContent = path || '';
  $nsFolder.title = path || '';
}

async function openNewSession() {
  // 체크박스 상태 복원(기본 체크)
  $nsClaude.checked = localStorage.getItem('csm-new-claude') !== '0';
  // 기본 폴더 로드
  setNsFolder('불러오는 중…');
  try {
    const r = await fetch('/api/new-session-default');
    const b = await r.json();
    setNsFolder(b.folder || '');
  } catch { setNsFolder(''); }
  $nsOverlay.classList.add('open');
}

function closeNewSession() { $nsOverlay.classList.remove('open'); }

document.getElementById('newSessionBtn').onclick = openNewSession;
document.getElementById('nsCancel').onclick = closeNewSession;
$nsOverlay.onclick = (e) => { if (e.target === $nsOverlay) closeNewSession(); };

$nsClaude.onchange = () => localStorage.setItem('csm-new-claude', $nsClaude.checked ? '1' : '0');

document.getElementById('nsPick').onclick = async () => {
  try {
    const r = await fetch('/api/pick-folder', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seed: $nsFolder.textContent }),
    });
    const b = await r.json();
    if (b.path) setNsFolder(b.path); // 이번 한 번만 적용(기본값은 안 바뀜)
  } catch (err) { $nsStatus.textContent = '실패: ' + err.message; }
};

document.getElementById('nsSetDefault').onclick = async () => {
  const folder = $nsFolder.textContent;
  try {
    const r = await fetch('/api/new-session-default', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder }),
    });
    const b = await r.json();
    $nsStatus.textContent = r.ok ? '기본 폴더로 저장했습니다.' : '실패: ' + b.error;
  } catch (err) { $nsStatus.textContent = '실패: ' + err.message; }
};

document.getElementById('nsOpen').onclick = async () => {
  const cwd = $nsFolder.textContent;
  try {
    const r = await fetch('/api/new-session', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, claude: $nsClaude.checked, mode: getOpenMode() }),
    });
    const b = await r.json();
    if (r.ok) { $nsStatus.textContent = '새 세션 터미널을 열었습니다.'; closeNewSession(); }
    else { $nsStatus.textContent = '실패: ' + b.error; }
  } catch (err) { $nsStatus.textContent = '실패: ' + err.message; }
};
```

- [ ] **Step 2: 전체 흐름 수동 검증**

Run: `node server.js` → 브라우저 새로고침 →
1. `+ 새 세션` 클릭 → 패널이 뜨고 기본 폴더가 채워짐, claude 체크박스 기본 체크.
2. `폴더 선택…` → 다이얼로그에서 다른 폴더 선택 → 경로가 그 폴더로 바뀜.
3. `열기` → 그 폴더에서 새 터미널 + claude 실행. 패널 닫힘, 상태줄에 안내.
4. 다시 열어 claude 체크 해제 → `열기` → 셸만 열림. 패널 다시 열면 체크 해제 상태 유지(localStorage).
5. `폴더 선택…`으로 딴 폴더 고르고 `기본으로 설정` → 패널 닫았다 다시 열면 그 폴더가 기본으로 채워짐.
6. `취소`/바깥 클릭 → 패널 닫힘.

- [ ] **Step 3: 회귀 테스트**

Run: `node --test`
Expected: PASS (모든 테스트)

- [ ] **Step 4: 커밋**

```bash
git add index.html
git commit -m "feat: 새 세션 패널 JS 배선(폴더/기본설정/claude 토글/열기)"
```

---

## Task 9: 문서 갱신 (README)

**Files:**
- Modify: `README.md`(기능 목록)

- [ ] **Step 1: 기능 항목 추가**

`README.md`의 `## 기능` 목록에서 `- [이어서 작업] ...` 항목 **위**에 추가:

```markdown
- [+ 새 세션] — 정해둔 기본 폴더(또는 그때 고른 폴더)에서 새 터미널을 열고,
  선택에 따라 claude를 바로 실행. 기본 폴더는 한 번 정하면 고정되고
  (`config.json`의 `newSession.defaultFolder`, 저장 전 자동 백업), claude 자동
  실행 여부는 브라우저에 기억됨
```

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: README에 새 세션 기능 설명 추가"
```

---

## Self-Review 결과

- **Spec coverage:** 헤더 accent 버튼(T7), 인라인/오버레이 패널(T7), 네이티브 폴더 다이얼로그(T5), claude on/off 체크박스+열기(T6/T8), 고정 기본폴더 모델+홈 폴백(T1/T4), 일회성 폴더 선택 vs 기본으로 설정(T8), config.json 머지+백업(T4), 빈 터미널 지원(T2/T3), 열기 방식 재사용(T2/T8), 테스트(T1/T2) — 스펙 항목 모두 태스크에 매핑됨.
- **Placeholder scan:** 모든 코드/명령 실체 포함, TBD/TODO 없음.
- **Type consistency:** `buildLaunchArgs({cwd, command, mode, hasWt})`, `readDefaultFolder(config)`, `withDefaultFolder(config, folder)`, `launchInTerminal(cwd, command, mode)`, 라우트 `/api/new-session-default|pick-folder|new-session` — 태스크 간 시그니처·경로 일치.
- **범위 밖(YAGNI):** 첫 프롬프트 미리 입력, 최근 폴더 목록, 즐겨찾기 다중 프로필 — 스펙대로 제외.
