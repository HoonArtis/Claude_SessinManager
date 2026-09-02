# MCP · 하네스 카탈로그 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 세션 매니저 앱에서 MCP 서버와 하네스·플러그인을 리스트업으로 보여주고, 골라서 딸깍 설치할 수 있게 한다.

**Architecture:** git으로 공유되는 `catalog.json`이 목록의 출처. 백엔드는 순수 함수(`lib/mcp-catalog.js`)로 argv/프롬프트/파싱을 만들고, `server.js` 라우트가 `claude` CLI를 `spawnSync`로 실행한다. MCP는 앱이 `claude mcp add`를 직접 실행, 하네스는 새 claude 세션에서 AI가 설치 스텝을 실행한다. 프론트는 `index.html`에 오버레이 패널을 추가(기존 터미널 단축키 오버레이 패턴 재사용).

**Tech Stack:** Node.js core만 사용(의존성 없음), `node:http`, `node:child_process`, `node --test`. 프론트는 바닐라 JS.

---

## File Structure

- Create: `catalog.json` — MCP/하네스 목록 (git 추적, 목록 출처)
- Create: `lib/mcp-catalog.js` — 순수 함수: `loadCatalog`, `buildMcpAddArgs`, `parseInstalledMcps`, `parseInstalledPlugins`, `buildHarnessPrompt`
- Create: `test/mcp-catalog.test.js` — 위 함수 단위 테스트
- Modify: `server.js` — `require` 추가 + 3개 라우트(`GET /api/catalog`, `POST /api/mcp-install`, `POST /api/harness-install`)
- Modify: `index.html` — 헤더 `[🧩 MCP]` 버튼 + 오버레이 패널 + CSS + 렌더/설치 JS
- Modify: `README.md` — 기능 설명 추가

참고: 완성형 프론트 마크업/CSS/JS는 `scratchpad/mcp-preview.html`에 이미 있음(목데이터 버전). Task 8~10은 이걸 오버레이로 이식하고 목데이터를 실제 API 호출로 교체하는 작업.

---

## Task 1: catalog.json 시드 파일

**Files:**
- Create: `catalog.json`

- [ ] **Step 1: catalog.json 작성**

`scratchpad/mcp-preview.html`의 `MCP`/`HARNESS` 배열을 JSON으로 옮긴다. 아래는 형식 예시 + impeccable 실제값. 나머지 항목은 preview의 데이터를 그대로 사용.

```json
{
  "mcp": [
    {
      "id": "github", "name": "GitHub", "category": "dev", "popular": true,
      "description": "이슈·PR·레포 조회·조작",
      "long": "저장소 검색, 파일 읽기, 이슈/PR 생성·코멘트, 브랜치 관리 등을 Claude가 직접 수행합니다.",
      "docs": "github.com/github/github-mcp-server",
      "transport": "stdio", "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"],
      "url": null, "headers": [],
      "env": [{ "key": "GITHUB_TOKEN", "label": "GitHub Personal Access Token", "help": "github.com/settings/tokens 에서 repo 권한으로 발급" }]
    },
    {
      "id": "playwright", "name": "Playwright", "category": "web", "popular": true,
      "description": "브라우저 자동 조작·스크린샷",
      "long": "실제 크로미움으로 페이지 이동·클릭·입력·스크린샷·접근성 트리 추출을 수행합니다.",
      "docs": "github.com/microsoft/playwright-mcp",
      "transport": "stdio", "command": "npx", "args": ["@playwright/mcp@latest"],
      "url": null, "headers": [], "env": []
    }
  ],
  "harness": [
    {
      "id": "impeccable", "name": "impeccable", "category": "design", "popular": true,
      "description": "AI가 만든 UI의 어색함을 감지·교정하는 디자인 하네스",
      "long": "\"에이전트를 위한 디자인 어휘\" — AI가 생성한 UI의 결함을 감지하고 정밀한 명령으로 인터페이스를 다듬습니다.",
      "docs": "impeccable.style",
      "steps": ["/plugin marketplace add pbakaus/impeccable", "/impeccable init"],
      "fallback": ["npx impeccable install"]
    },
    {
      "id": "superpowers", "name": "superpowers", "category": "workflow", "popular": true,
      "description": "brainstorm·TDD·디버깅 등 개발 워크플로우 스킬 묶음",
      "long": "브레인스토밍, 계획 작성, TDD, 체계적 디버깅 등 개발 워크플로우 스킬을 한 번에 설치합니다.",
      "docs": "github.com/obra/superpowers",
      "steps": ["/plugin marketplace add obra/superpowers", "/plugin install superpowers@superpowers-marketplace"],
      "fallback": []
    }
  ]
}
```

> 최소 위 4개 항목은 반드시 넣는다. 나머지는 preview의 MCP 12개·하네스 4개를 옮겨 채운다(있으면 좋고, 없어도 기능 동작엔 무방).

- [ ] **Step 2: JSON 유효성 확인**

Run: `node -e "JSON.parse(require('fs').readFileSync('catalog.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add catalog.json
git commit -m "feat: MCP·하네스 카탈로그 시드(catalog.json) 추가"
```

---

## Task 2: buildMcpAddArgs (순수 함수)

**Files:**
- Create: `lib/mcp-catalog.js`
- Test: `test/mcp-catalog.test.js`

- [ ] **Step 1: 실패 테스트 작성**

`test/mcp-catalog.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { buildMcpAddArgs } = require('../lib/mcp-catalog');

test('stdio: scope와 -- 구분자, args 포함', () => {
  const entry = { id: 'playwright', transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: [] };
  const argv = buildMcpAddArgs(entry, { scope: 'user' });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-s', 'user', 'playwright', '--', 'npx', '@playwright/mcp@latest']);
});

test('stdio: env 값이 있으면 -e KEY=val 추가', () => {
  const entry = { id: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], env: [{ key: 'GITHUB_TOKEN' }] };
  const argv = buildMcpAddArgs(entry, { scope: 'project', envValues: { GITHUB_TOKEN: 'ghp_x' } });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-s', 'project', '-e', 'GITHUB_TOKEN=ghp_x', 'github', '--', 'npx', '-y', 'srv']);
});

test('stdio: env 값이 비어 있으면 -e 생략', () => {
  const entry = { id: 'github', transport: 'stdio', command: 'npx', args: [], env: [{ key: 'GITHUB_TOKEN' }] };
  const argv = buildMcpAddArgs(entry, { scope: 'user', envValues: {} });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-s', 'user', 'github', '--', 'npx']);
});

test('http: -t http와 url, 헤더 값 포함', () => {
  const entry = { id: 'sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', headers: [{ key: 'Authorization' }] };
  const argv = buildMcpAddArgs(entry, { scope: 'user', headerValues: { Authorization: 'Bearer z' } });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-t', 'http', '-s', 'user', '-H', 'Authorization: Bearer z', 'sentry', 'https://mcp.sentry.dev/mcp']);
});

test('scope 미지정 시 기본 user', () => {
  const entry = { id: 'x', transport: 'stdio', command: 'c', args: [], env: [] };
  const argv = buildMcpAddArgs(entry, {});
  assert.strictEqual(argv[3], 'user');
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/mcp-catalog.test.js`
Expected: FAIL — `Cannot find module '../lib/mcp-catalog'`

- [ ] **Step 3: 최소 구현**

`lib/mcp-catalog.js`:

```js
'use strict';

// claude mcp add 에 넘길 argv 배열을 만든다(순수).
// stdio: mcp add [-s scope] [-e K=V ...] <id> -- <command> [args...]
// http:  mcp add -t http [-s scope] [-H "K: V" ...] <id> <url>
function buildMcpAddArgs(entry, opts = {}) {
  const scope = opts.scope || 'user';
  if (entry.transport === 'http') {
    const args = ['mcp', 'add', '-t', 'http', '-s', scope];
    for (const h of entry.headers || []) {
      const val = (opts.headerValues || {})[h.key];
      if (val) args.push('-H', `${h.key}: ${val}`);
    }
    args.push(entry.id, entry.url);
    return args;
  }
  const args = ['mcp', 'add', '-s', scope];
  for (const e of entry.env || []) {
    const val = (opts.envValues || {})[e.key];
    if (val) args.push('-e', `${e.key}=${val}`);
  }
  args.push(entry.id, '--', entry.command, ...(entry.args || []));
  return args;
}

module.exports = { buildMcpAddArgs };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/mcp-catalog.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/mcp-catalog.js test/mcp-catalog.test.js
git commit -m "feat: buildMcpAddArgs — claude mcp add argv 빌더"
```

---

## Task 3: parseInstalledMcps / parseInstalledPlugins (순수 함수)

**Files:**
- Modify: `lib/mcp-catalog.js`
- Test: `test/mcp-catalog.test.js`

- [ ] **Step 1: 실패 테스트 추가**

`test/mcp-catalog.test.js` 하단에 append:

```js
const { parseInstalledMcps, parseInstalledPlugins } = require('../lib/mcp-catalog');

test('parseInstalledMcps: 이름(공백 포함) 추출, 헤더/진단 줄 무시', () => {
  const out = [
    'Checking MCP server health…',
    '',
    'claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication',
    'blender: uvx blender-mcp - ✔ Connected',
    'MCP config diagnostics ⚠',
    '[Conflicting scopes]',
  ].join('\n');
  const set = parseInstalledMcps(out);
  assert.strictEqual(set.has('claude.ai Slack'), true);
  assert.strictEqual(set.has('blender'), true);
  assert.strictEqual(set.has('[Conflicting scopes]'), false);
  assert.strictEqual(set.size, 2);
});

test('parseInstalledPlugins: name@marketplace 에서 name 추출', () => {
  const out = [
    'Installed plugins:',
    '',
    '  ❯ elements-of-style@superpowers-marketplace',
    '    Version: 1.0.0',
    '  ❯ superpowers@superpowers-marketplace',
    '    Status: ✔ enabled',
  ].join('\n');
  const set = parseInstalledPlugins(out);
  assert.strictEqual(set.has('elements-of-style'), true);
  assert.strictEqual(set.has('superpowers'), true);
  assert.strictEqual(set.size, 2);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/mcp-catalog.test.js`
Expected: FAIL — `parseInstalledMcps is not a function`

- [ ] **Step 3: 구현 추가**

`lib/mcp-catalog.js`의 `module.exports` 앞에 추가:

```js
// `claude mcp list` 출력에서 설치된 서버 이름 Set 추출.
// 각 줄 형식: "<이름>: <명령/URL> - <상태>"  (이름에 공백 가능)
function parseInstalledMcps(text) {
  const set = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(.+?): .+ - /);
    if (m) set.add(m[1].trim());
  }
  return set;
}

// `claude plugin list` 출력에서 설치된 플러그인 이름 Set 추출.
// 각 줄 형식: "  ❯ <name>@<marketplace>"
function parseInstalledPlugins(text) {
  const set = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/❯\s+([^@\s]+)@/);
    if (m) set.add(m[1]);
  }
  return set;
}
```

그리고 exports 갱신:

```js
module.exports = { buildMcpAddArgs, parseInstalledMcps, parseInstalledPlugins };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/mcp-catalog.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/mcp-catalog.js test/mcp-catalog.test.js
git commit -m "feat: 설치된 MCP/플러그인 목록 파서"
```

---

## Task 4: loadCatalog / buildHarnessPrompt (순수 함수)

**Files:**
- Modify: `lib/mcp-catalog.js`
- Test: `test/mcp-catalog.test.js`

- [ ] **Step 1: 실패 테스트 추가**

`test/mcp-catalog.test.js` 하단에 append:

```js
const path = require('node:path');
const { loadCatalog, buildHarnessPrompt } = require('../lib/mcp-catalog');

test('loadCatalog: mcp/harness 배열을 반환', () => {
  const cat = loadCatalog(path.join(__dirname, '..'));
  assert.ok(Array.isArray(cat.mcp));
  assert.ok(Array.isArray(cat.harness));
  assert.ok(cat.mcp.length > 0);
});

test('buildHarnessPrompt: 여러 하네스 steps를 병합', () => {
  const entries = [
    { name: 'impeccable', steps: ['/plugin marketplace add pbakaus/impeccable', '/impeccable init'] },
    { name: 'superpowers', steps: ['/plugin install superpowers@superpowers-marketplace'] },
  ];
  const p = buildHarnessPrompt(entries);
  assert.match(p, /impeccable/);
  assert.match(p, /\/plugin marketplace add pbakaus\/impeccable/);
  assert.match(p, /\/impeccable init/);
  assert.match(p, /superpowers@superpowers-marketplace/);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `node --test test/mcp-catalog.test.js`
Expected: FAIL — `loadCatalog is not a function`

- [ ] **Step 3: 구현 추가**

`lib/mcp-catalog.js` 상단에 `require` 추가:

```js
const fs = require('node:fs');
const path = require('node:path');
```

`module.exports` 앞에 추가:

```js
// catalog.json 읽어 { mcp, harness } 반환. 없거나 깨졌으면 빈 배열.
function loadCatalog(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8');
    const j = JSON.parse(raw);
    return { mcp: Array.isArray(j.mcp) ? j.mcp : [], harness: Array.isArray(j.harness) ? j.harness : [] };
  } catch {
    return { mcp: [], harness: [] };
  }
}

// 선택된 하네스들을 새 claude 세션에서 설치하도록 지시하는 프롬프트 생성.
function buildHarnessPrompt(entries) {
  const blocks = entries.map((h) => {
    const steps = (h.steps || []).map((s) => `  - ${s}`).join('\n');
    return `### ${h.name}\n${steps}`;
  });
  return [
    '아래 하네스/플러그인을 설치해줘. 각 항목의 명령을 순서대로 실행하면 돼.',
    '슬래시 명령(/plugin, /impeccable init 등)은 그대로 실행하고, 설치가 끝나면 결과를 알려줘.',
    '',
    ...blocks,
  ].join('\n');
}
```

exports 갱신:

```js
module.exports = { buildMcpAddArgs, parseInstalledMcps, parseInstalledPlugins, loadCatalog, buildHarnessPrompt };
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test test/mcp-catalog.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/mcp-catalog.js test/mcp-catalog.test.js
git commit -m "feat: loadCatalog + buildHarnessPrompt"
```

---

## Task 5: GET /api/catalog 라우트

**Files:**
- Modify: `server.js` (require 블록 ~line 14, 라우트는 line 948 `sendJson(res, 404 ...)` 직전)

- [ ] **Step 1: require 추가**

`server.js` line 14 (`buildHandoffMd` require) 아래에 추가:

```js
const { loadCatalog, buildMcpAddArgs, buildHarnessPrompt, parseInstalledMcps, parseInstalledPlugins } = require('./lib/mcp-catalog');
```

- [ ] **Step 2: 설치 감지 헬퍼 추가**

`server.js`의 `launchFreshClaude` 함수(line ~201) 아래에 추가:

```js
// 설치된 MCP/플러그인 이름을 CLI로 조회(실패해도 빈 배열).
function detectInstalled() {
  const result = { mcp: [], harness: [] };
  try {
    const r = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 20000, env: CLEAN_ENV });
    if (r.stdout) result.mcp = [...parseInstalledMcps(r.stdout)];
  } catch {}
  try {
    const r = spawnSync('claude', ['plugin', 'list'], { encoding: 'utf8', timeout: 20000, env: CLEAN_ENV });
    if (r.stdout) result.harness = [...parseInstalledPlugins(r.stdout)];
  } catch {}
  return result;
}
```

- [ ] **Step 3: 라우트 추가**

line 948 `sendJson(res, 404, { error: 'not found' });` **직전**에 추가:

```js
    if (req.method === 'GET' && req.url === '/api/catalog') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      const cat = loadCatalog(__dirname);
      sendJson(res, 200, { ...cat, installed: detectInstalled() });
      return;
    }
```

- [ ] **Step 4: 수동 확인**

Run: `node -e "const s=require('./server.js')" 2>&1 | head -5` (문법 오류 없음 확인 — 서버가 뜨면 Ctrl+C)
대안: 서버 실행 후 `curl http://localhost:7777/api/catalog` 로 `{"mcp":[...],"harness":[...],"installed":{...}}` 확인.
Expected: JSON 응답, `mcp` 배열에 항목 존재.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat: GET /api/catalog — 카탈로그 + 설치 감지"
```

---

## Task 6: POST /api/mcp-install 라우트

**Files:**
- Modify: `server.js` (Task 5에서 추가한 `/api/catalog` 라우트 아래)

- [ ] **Step 1: 라우트 추가**

`/api/catalog` 라우트 아래에 추가:

```js
    if (req.method === 'POST' && req.url === '/api/mcp-install') {
      if (!isLoopback(req)) { sendJson(res, 403, { error: '이 기능은 자기 컴퓨터에서만 쓸 수 있습니다.' }); return; }
      let body;
      try { body = JSON.parse(await readBody(req)); } catch { sendJson(res, 400, { error: '잘못된 JSON 본문입니다.' }); return; }
      const { items, scope, projectDir } = body || {};
      if (!Array.isArray(items) || !items.length) { sendJson(res, 400, { error: '설치할 항목이 없습니다.' }); return; }
      const useScope = scope === 'project' ? 'project' : 'user';
      const cwd = useScope === 'project' ? projectDir : undefined;
      if (useScope === 'project' && !validCwd(res, cwd)) return;
      const cat = loadCatalog(__dirname);
      const byId = new Map(cat.mcp.map((m) => [m.id, m]));
      const results = [];
      for (const it of items) {
        const entry = byId.get(it && it.id);
        if (!entry) { results.push({ id: it && it.id, ok: false, message: '카탈로그에 없는 항목' }); continue; }
        const argv = buildMcpAddArgs(entry, { scope: useScope, envValues: it.envValues || {}, headerValues: it.headerValues || {} });
        const r = spawnSync('claude', argv, { encoding: 'utf8', timeout: 120000, cwd, env: CLEAN_ENV });
        const ok = r.status === 0;
        results.push({ id: entry.id, ok, message: ok ? '설치됨' : ((r.stderr || r.stdout || r.error?.message || '실패').trim().slice(0, 400)) });
      }
      sendJson(res, 200, { results });
      return;
    }
```

- [ ] **Step 2: 수동 확인 (env 없는 MCP로)**

서버 실행 후:
Run: `curl -s -X POST http://localhost:7777/api/mcp-install -H "Content-Type: application/json" -d "{\"items\":[{\"id\":\"playwright\"}],\"scope\":\"user\"}"`
Expected: `{"results":[{"id":"playwright","ok":true,"message":"설치됨"}]}`
확인 후: `claude mcp remove playwright -s user` 로 원복.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: POST /api/mcp-install — 선택 MCP 설치"
```

---

## Task 7: POST /api/harness-install 라우트

**Files:**
- Modify: `server.js` (`/api/mcp-install` 라우트 아래)

- [ ] **Step 1: 라우트 추가**

```js
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
      const prompt = buildHarnessPrompt(entries).replace(/"/g, '\\"');
      launchInTerminal(os.homedir(), `claude "${prompt}"`, mode);
      sendJson(res, 200, { ok: true, launched: entries.map((e) => e.id) });
      return;
    }
```

- [ ] **Step 2: 수동 확인**

서버 실행 후:
Run: `curl -s -X POST http://localhost:7777/api/harness-install -H "Content-Type: application/json" -d "{\"ids\":[\"superpowers\"]}"`
Expected: `{"ok":true,"launched":["superpowers"]}` + 새 터미널에 claude 세션이 설치 프롬프트와 함께 뜬다. (설치까지 진행할 필요 없음 — 세션이 뜨는지만 확인, 창 닫기)

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "feat: POST /api/harness-install — 새 세션에서 하네스 설치"
```

---

## Task 8: 헤더 [🧩 MCP] 버튼 + 오버레이 셸 + CSS

**Files:**
- Modify: `index.html` (헤더 line ~213, CSS는 `<style>` 블록 내, 오버레이 마크업은 기존 kb 오버레이 근처)

- [ ] **Step 1: 헤더 버튼 추가**

`index.html` line 213 `<button id="verUpdateBtn" hidden>...` **직전**에 추가:

```html
  <button id="mcpBtn"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/><path d="M11 7h4a2 2 0 0 1 2 2v4M7 11v2a2 2 0 0 0 2 2h2"/></svg> MCP</button>
```

- [ ] **Step 2: 버튼 CSS 추가**

`#kbBtn { ... }` 규칙(line ~33) 아래에 추가:

```css
  #mcpBtn { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); font-size: 15px; color: var(--text); cursor: pointer; }
  #mcpBtn:hover { border-color: var(--accent); color: var(--accent); }
```

- [ ] **Step 3: 오버레이 마크업 추가**

`index.html`의 `</body>` 직전(또는 기존 kb 오버레이 마크업 아래)에 추가. `scratchpad/mcp-preview.html`의 `<div class="wrap">…</div>`와 `<div class="installbar">…</div>` 두 블록을 오버레이로 감싼다:

```html
<div id="mcpOverlay" class="mcp-overlay" role="dialog" aria-modal="true" aria-label="MCP·하네스 카탈로그" hidden>
  <div class="mcp-modal">
    <button id="mcpClose" class="mcp-close" aria-label="닫기">✕</button>
    <!-- 여기에 preview의 .wrap 내용 이식 -->
    <!-- 하단에 preview의 .installbar 이식 -->
  </div>
</div>
```

- [ ] **Step 4: 오버레이 CSS 추가**

`<style>` 블록에 추가(기존 kb 오버레이 CSS 톤에 맞춤):

```css
  .mcp-overlay { position: fixed; inset: 0; background: rgba(28,33,40,.45); display: flex; align-items: stretch; justify-content: center; z-index: 100; }
  .mcp-overlay[hidden] { display: none; }
  .mcp-modal { position: relative; background: var(--bg); width: min(1000px, 100%); margin: 24px; border-radius: 14px; overflow-y: auto; box-shadow: 0 12px 48px rgba(0,0,0,.25); }
  .mcp-close { position: absolute; top: 14px; right: 16px; z-index: 30; width: 36px; height: 36px; border: 1px solid var(--border); border-radius: 8px; background: var(--panel); font-size: 16px; color: var(--muted); cursor: pointer; }
  .mcp-close:hover { border-color: var(--danger); color: var(--danger); }
```

`scratchpad/mcp-preview.html`의 `<style>`에서 카탈로그 관련 규칙(`.wrap`, `.top`, `.views`, `.controls`, `.chip`, `.group`, `.cards`, `.card`, `.tag`, `.detail`, `.cmd`, `.envbox`, `.installbar` 등)을 전부 복사해 넣는다. `body` 규칙은 복사하지 말 것(기존 앱 body와 충돌). `.installbar`는 `position: fixed`를 `position: sticky; bottom: 0;`로 바꿔 모달 내부에 붙게 한다.

- [ ] **Step 5: 열기/닫기 JS 추가**

`index.html` 스크립트 하단(`document.getElementById('kbBtn').onclick = ...` 근처)에 추가:

```js
const $mcpOverlay = document.getElementById('mcpOverlay');
document.getElementById('mcpBtn').onclick = () => { $mcpOverlay.hidden = false; loadCatalog(); };
document.getElementById('mcpClose').onclick = () => { $mcpOverlay.hidden = true; };
$mcpOverlay.addEventListener('click', (e) => { if (e.target === $mcpOverlay) $mcpOverlay.hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$mcpOverlay.hidden) $mcpOverlay.hidden = true; });
```

> `loadCatalog()`는 Task 9에서 정의. 이 단계에서는 임시로 `function loadCatalog(){}` 빈 함수를 먼저 넣어 열기/닫기만 확인.

- [ ] **Step 6: 수동 확인**

서버 실행 → 브라우저에서 `[🧩 MCP]` 클릭 → 빈 모달이 뜨고 ✕/Esc/바깥클릭으로 닫힘.
Expected: 오버레이 열기·닫기 동작.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat: MCP 오버레이 패널 셸 + 헤더 버튼"
```

---

## Task 9: 카탈로그 렌더링 (API 연동)

**Files:**
- Modify: `index.html` (스크립트)

- [ ] **Step 1: preview의 렌더 JS 이식 + 목데이터 제거**

`scratchpad/mcp-preview.html`의 `<script>`에서 렌더 관련 함수(`esc`, `mcpCmd`, `harCmd`, `cardHtml`, `render`, `renderChips`, `wire`, `syncSel`, 토글/칩/검색 이벤트 핸들러, `CATS_MCP`, `CATS_HAR`, `TAGDEF`, 상태변수 `view/curCat/q/selMcp/selHar`)를 `index.html` 스크립트로 복사한다.

**단, 목데이터 `const MCP=[...]`, `const HARNESS=[...]`는 복사하지 말 것.** 대신 상단에 빈 상태로 선언:

```js
let CATALOG = { mcp: [], harness: [], installed: { mcp: [], harness: [] } };
```

그리고 `curList()`를 API 데이터 기준으로 바꾼다:

```js
const curList = () => view === 'mcp' ? CATALOG.mcp : CATALOG.harness;
```

`cardHtml`에서 설치 여부는 `installed` 배열로 판단하도록 수정(preview는 `tags.includes('installed')`였음):

```js
function isInstalled(m) {
  const inst = view === 'mcp' ? CATALOG.installed.mcp : CATALOG.installed.harness;
  return inst.includes(m.id) || inst.includes(m.name);
}
```
`cardHtml` 안의 `const isInst = m.tags.includes('installed');` → `const isInst = isInstalled(m);` 로 교체.
태그 렌더링에서 `installed`/`plugin`/`free` 등은 카탈로그 필드에서 유도: `popular→pop`, `env.length→env`(mcp)·`env없으면 free`, harness는 `plugin`(steps에 /plugin 포함)·`git`(아니면). preview의 `m.tags` 대신 아래 함수로 태그 생성:

```js
function tagsFor(m) {
  const t = [];
  if (m.popular) t.push('pop');
  if (view === 'mcp') { (m.env && m.env.length) ? t.push('env') : t.push('free'); }
  else { (m.steps || []).some(s => s.startsWith('/plugin')) ? t.push('plugin') : t.push('git'); }
  if (isInstalled(m)) t.push('installed');
  return t;
}
```
`cardHtml`의 `const tags = m.tags.map(...)` → `const tags = tagsFor(m).map(...)`.

- [ ] **Step 2: loadCatalog() 구현**

Task 8에서 넣은 빈 `loadCatalog`를 교체:

```js
async function loadCatalog() {
  try {
    const r = await fetch('/api/catalog');
    CATALOG = await r.json();
  } catch { CATALOG = { mcp: [], harness: [], installed: { mcp: [], harness: [] } }; }
  document.getElementById('vnMcp').textContent = CATALOG.mcp.length;
  document.getElementById('vnHar').textContent = CATALOG.harness.length;
  renderChips();
  render();
}
```

- [ ] **Step 3: 수동 확인**

서버 실행 → `[🧩 MCP]` → 카드 목록이 실제 `catalog.json` 항목으로 렌더. 세그먼트 토글·검색·칩 필터·자세히 보기 동작. 이미 설치된 항목(예: playwright/superpowers)에 `●설치됨` 배지.
Expected: 실데이터 렌더 + 배지 정확.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: 카탈로그 실데이터 렌더링(/api/catalog 연동)"
```

---

## Task 10: 설치 버튼 연동 (MCP + 하네스)

**Files:**
- Modify: `index.html` (스크립트)

- [ ] **Step 1: 설치 실행 함수 추가**

설치바의 `.btn-install` 클릭 핸들러를 추가한다. preview에는 없던 부분:

```js
function collectEnv(id) {
  // 열린 카드의 env 입력칸에서 값 수집
  const card = document.querySelector(`.card[data-id="${id}"]`);
  const vals = {};
  if (card) card.querySelectorAll('.envfield').forEach((f) => {
    const code = f.querySelector('label code'); const inp = f.querySelector('input');
    if (code && inp) vals[code.textContent.trim()] = inp.value.trim();
  });
  return vals;
}

document.querySelector('.btn-install').onclick = async () => {
  const S = curSel(); if (!S.size) return;
  const btn = document.querySelector('.btn-install');
  btn.disabled = true; btn.textContent = '설치 중…';
  try {
    if (view === 'mcp') {
      const scope = document.querySelector('.scope .seg button.on').dataset.scope;
      let projectDir;
      if (scope === 'project') {
        const r = await fetch('/api/pick-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const j = await r.json();
        if (j.cancelled || !j.path) { btn.disabled = false; return; }
        projectDir = j.path;
      }
      const items = [...S].map((id) => ({ id, envValues: collectEnv(id) }));
      const res = await fetch('/api/mcp-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items, scope, projectDir }) });
      const j = await res.json();
      alert((j.results || []).map((x) => `${x.id}: ${x.ok ? '✅ 설치됨' : '❌ ' + x.message}`).join('\n') || j.error);
    } else {
      const res = await fetch('/api/harness-install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...S] }) });
      const j = await res.json();
      alert(j.ok ? `새 터미널에서 설치를 시작합니다: ${j.launched.join(', ')}` : ('실패: ' + j.error));
    }
    S.clear();
    await loadCatalog();
  } catch (e) {
    alert('설치 실패: ' + e.message);
  } finally {
    btn.disabled = false;
  }
};
```

> `.btn-install`의 라벨 텍스트는 `syncSel`이 `#selN2`로 갱신하므로, 위에서 `btn.textContent='설치 중…'` 후 `loadCatalog()`→`render()`→`syncSel()`가 원복. 원복이 안 되면 `syncSel()` 끝에 라벨 재구성 코드 확인.

- [ ] **Step 2: 수동 확인 — env 없는 MCP**

`[🧩 MCP]` → playwright 등 env 없는 항목 체크 → user scope → 설치 → `✅ 설치됨` alert → 배지 갱신.
확인 후 원복: `claude mcp remove playwright -s user`.
Expected: 설치 성공 + 목록 새로고침.

- [ ] **Step 3: 수동 확인 — 하네스**

`[⚙️ 하네스·플러그인]` → 항목 체크 → 설치 → 새 터미널에 claude 세션이 설치 프롬프트와 함께 뜸(설치는 진행 안 해도 됨, 창 닫기).
Expected: 세션 실행 alert + 터미널.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: MCP·하네스 설치 버튼 연동"
```

---

## Task 11: README 업데이트 + 전체 검증

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README에 기능 추가**

`## 기능` 목록에 항목 추가:

```markdown
- [🧩 MCP] — MCP 서버·하네스·플러그인을 카탈로그(`catalog.json`)에서 골라 딸깍
  설치. 여러 개 다중 선택 가능. MCP는 앱이 `claude mcp add`로 직접 설치(user/
  project scope 선택, 필요한 키는 설치 전 입력), 하네스는 새 claude 세션에서
  AI가 설치 스텝(`/plugin …` 등)을 실행. 목록은 git으로 공유·최신화.
```

- [ ] **Step 2: 전체 테스트**

Run: `node --test`
Expected: 기존 테스트 + `mcp-catalog.test.js` 전부 PASS.

- [ ] **Step 3: 최종 웹 검증**

서버 실행 후 브라우저에서: 카탈로그 렌더 / 검색·필터 / 자세히 보기 / MCP 설치(env 없는 것) / 하네스 세션 실행 / 설치 배지 갱신 — 전부 확인.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README에 MCP·하네스 카탈로그 기능 추가"
```

---

## Self-Review 결과

- **Spec coverage:** catalog.json(T1), lib 순수함수 4종(T2~4), 3개 라우트(T5~7), 프론트 패널·렌더·설치(T8~10), README·테스트(T11) — spec의 모든 섹션 커버.
- **타입 일관성:** `buildMcpAddArgs(entry, opts)`, `parseInstalledMcps/Plugins(text)→Set`, `loadCatalog(dir)→{mcp,harness}`, `buildHarnessPrompt(entries)→string`, API: `/api/catalog`(GET), `/api/mcp-install`·`/api/harness-install`(POST) — 전 태스크에서 이름·시그니처 일치.
- **설치 감지:** `isInstalled`는 id 또는 name 매칭(MCP는 name, 플러그인은 id로 잡힘) — 양쪽 커버.
