# MCP · 하네스 카탈로그 — 설계

작성일: 2026-08-28 · 브랜치: `feat/new-session-launcher` (또는 신규 `feat/mcp-catalog`)

## 목적

팀원이 세션 매니저 앱 안에서 **MCP 서버**와 **하네스·플러그인**을 리스트업으로
보고, 원하는 것을 골라 **딸깍 한 번으로 설치**한다. 새 팀원 온보딩 시 필요한
도구 셋업을 최대한 빠르게 끝내는 것이 목표.

핵심 원칙:
- 목록(카탈로그)은 git으로 공유한다. `git pull` 하면 최신 목록을 본다.
- 앱은 Claude 설정 파일(`~/.claude.json` 등)을 **직접 편집하지 않는다.**
  설치는 항상 `claude` CLI에 위임한다 → 전역 규칙("기본 건드리지 마라") 준수.
- 설치 기능은 자기 컴퓨터에서만 동작한다(기존 install 계열과 동일하게
  `isLoopback` 가드). 원격 PC의 설치는 지원하지 않는다.

## 데이터: `catalog.json` (git 추적)

앱 폴더 루트에 커밋한다. 두 종류를 담는다.

```jsonc
{
  "mcp": [
    {
      "id": "github",
      "name": "GitHub",
      "category": "dev",                 // dev|web|data|collab|ai
      "description": "이슈·PR·레포 조회·조작",
      "long": "저장소 검색, 이슈/PR 생성 등…",
      "docs": "github.com/github/github-mcp-server",
      "popular": true,
      "transport": "stdio",              // "stdio" | "http"
      "command": "npx",                  // stdio일 때
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "url": null,                       // http일 때 사용
      "headers": [],                     // http일 때 [{key,label,help}]
      "env": [                           // stdio 비밀값
        { "key": "GITHUB_TOKEN", "label": "GitHub Token", "help": "settings/tokens 에서 발급" }
      ]
    }
  ],
  "harness": [
    {
      "id": "impeccable",
      "name": "impeccable",
      "category": "design",              // workflow|quality|design|domain
      "description": "AI가 만든 UI의 어색함을 교정하는 디자인 하네스",
      "long": "…",
      "docs": "impeccable.style",
      "popular": true,
      "steps": [                         // 새 claude 세션에서 순서대로 실행
        "/plugin marketplace add pbakaus/impeccable",
        "/impeccable init"
      ],
      "fallback": ["npx impeccable install"]  // 위가 안 될 때 안내용
    }
  ]
}
```

- MCP `env`/`headers`는 **값을 넣지 않는다**(개인 비밀키). 설치 직전 UI에서 입력받는다.
- 하네스 `steps`에는 슬래시 명령(`/plugin …`)이 들어갈 수 있어 앱이 직접 못 돈다
  → 새 claude 세션에서 AI가 실행한다(아래 참조).

## 백엔드

### `lib/mcp-catalog.js` (순수 함수 · 단위 테스트 대상)

- `loadCatalog(dir)` — `catalog.json` 읽어 검증(필드 누락·형식) 후 `{mcp, harness}` 반환.
- `buildMcpAddArgs(entry, { scope, envValues, headerValues })` → `claude mcp add`에 넘길
  argv 배열을 만든다. 순수 함수라 테스트하기 쉽다.
  - stdio: `["mcp","add","-s",scope, ...envFlags, id, "--", command, ...args]`
    (envFlags = `["-e","KEY=val", ...]`)
  - http: `["mcp","add","-t","http","-s",scope, ...headerFlags, id, url]`
- `parseInstalledMcps(text)` — `claude mcp list` 출력에서 설치된 서버 이름 Set 추출.
  각 줄 `이름: 명령 - 상태` → 첫 `": "` 앞부분이 이름. (이름에 공백 가능)
- `parseInstalledPlugins(text)` — `claude plugin list` 출력에서 설치된 플러그인 이름 Set.
- `buildHarnessPrompt(entries)` — 선택된 하네스들의 `steps`를 모아, 새 세션에서
  AI가 실행하도록 지시하는 프롬프트 문자열을 만든다.

### 라우트 (`server.js`) — 전부 `isLoopback` 가드

- `GET /api/catalog` → `{ mcp, harness, installed: { mcp:[…names], harness:[…names] } }`
  - `installed`는 `claude mcp list` / `claude plugin list`를 `spawnSync`로 돌려 파싱.
    CLI가 없거나 실패하면 `installed`는 빈 배열(설치 배지만 안 뜸, 목록은 정상).
- `POST /api/mcp-install` — body `{ items:[{id, envValues, headerValues}], scope, projectDir? }`
  - scope=project면 `projectDir`에서 `claude mcp add` 실행(`cwd` 지정), 아니면 그대로.
  - 각 item마다 `buildMcpAddArgs`로 argv 만들어 `spawnSync('claude', argv)`.
  - 결과 배열 `[{id, ok, message}]` 반환(부분 성공 허용).
- `POST /api/harness-install` — body `{ ids:[…] }`
  - `buildHarnessPrompt`로 프롬프트 생성 → 새 claude 세션을 연다
    (기존 `launchInTerminal` 재사용, `command = claude "<prompt>"`).
  - 세션이 뜨면 AI가 `/plugin …`·`/impeccable init` 등을 실행. 앱은 실행만 트리거.

## 프론트엔드 (`index.html`)

기존 앱에 **MCP 패널**을 추가한다(헤더에 `[🧩 MCP]` 버튼 → 패널 열기).
미리보기(`scratchpad/mcp-preview.html`)의 구조를 그대로 이식:

- 상단 세그먼트 토글 **[🧩 MCP 서버] / [⚙️ 하네스·플러그인]**
- 검색 + 카테고리 칩(개수 배지)
- 카드: 체크박스 다중선택 · 태그(⭐인기 / 🔑env필요 / ✓즉시설치 / ●설치됨 /
  🧩플러그인) · [자세히 보기] 펼침(설명·실제 명령·env·docs)
- env 필요한 MCP는 펼침 안에 값 입력칸(라벨·도움말)
- 하단 sticky 설치바: `N개 선택됨`, MCP일 때 scope 토글(user/project,
  project면 기존 폴더 선택창 재사용), 하네스일 때 "전역 설치" 안내, `설치` 버튼
- 설치 후 결과 토스트/인라인(성공·실패 표시), 설치된 항목은 `●설치됨` 갱신

## 테스트 (`test/mcp-catalog.test.js`, `node --test`)

- `buildMcpAddArgs` — stdio/http, scope, env/header 플래그 순서
- `parseInstalledMcps` / `parseInstalledPlugins` — 공백 포함 이름·상태 줄 파싱
- `buildHarnessPrompt` — 여러 하네스 steps 병합
- `loadCatalog` — 정상/필드 누락 검증

## 범위 밖 (YAGNI / 나중에)

- UI에서 카탈로그 편집·항목 추가(카탈로그는 git으로 관리)
- 원격 PC 설치, MCP 제거/업데이트 UI
- env 값 저장(입력값은 설치 1회에만 사용; claude CLI가 자기 config에 저장)
- 하네스 설치 성공 여부 자동 확인(세션에서 AI가 처리)
