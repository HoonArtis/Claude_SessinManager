# 새 세션 시작 (임의 폴더 + 선택적 claude) — 설계

작성일: 2026-08-28

## 문제 / 목적

지금 앱은 **기존 세션**에 대해서만 터미널을 연다(`launchInTerminal` →
`claude --resume <id>`). 사용자는 기존 세션과 무관하게 **원하는 폴더에서
새 터미널을 열고, 선택적으로 claude를 바로 실행**하고 싶다.

폴더를 앱에서 미리 정해 넘기면 터미널이 그 폴더(cwd)에서 켜지고 claude가
그 자리에서 바로 시작한다. "어디서 작업할까요" 같은 왕복이 없어지고 첫
프롬프트를 본론부터 쓸 수 있다. (폴더 지정은 OS 프로세스의 시작
디렉터리를 정하는 것이라 토큰 비용이 없다.)

## 결정사항 (확정)

- **UI**: 상단 헤더 툴바에 `+ 새 세션` 버튼 추가 → 클릭 시 **인라인 패널**.
- **폴더 선택**: 네이티브 폴더 선택 다이얼로그(서버가 PowerShell로 띄움).
  브라우저는 OS 폴더창을 직접 못 열지만, 같은 PC의 Node 서버가 대신 띄운다.
- **claude 실행**: `☑ claude 자동 실행` 체크박스 + `열기` 버튼 (기본 체크).
- **기본 폴더 모델** (Windows Terminal / VS Code 방식):
  - 사용자가 정한 **고정 기본값 하나**를 쓴다. 패널을 열면 항상 이 값이 채워진다.
  - 아직 안 정했으면 **홈 폴더(`%USERPROFILE%`)** 로 폴백.
  - `폴더 선택…`으로 다른 폴더를 고르면 **이번 한 번만** 적용(one-off),
    기본값은 바뀌지 않는다.
  - 기본값을 바꾸려면 폴더를 고른 뒤 **`기본으로 설정`** 을 눌렀을 때만.
- **체크박스 상태**: `localStorage` 캐시로 이전 상태 기억(환경값이므로 마지막값 기억이 맞음).
- **열기 방식**(새 창/탭/분할 →/↓): 기존 `OPEN_MODES` 그대로 재사용.
- **빈 터미널 지원**: claude 미체크 시 그 폴더에서 셸만 연다.

### 근거 (타 도구 조사, 2026-08-28)

- Windows Terminal `startingDirectory`, VS Code `files.dialog.defaultPath`,
  Warp `custom_dir` — 견고한 도구는 전부 **한 번 정한 고정 기본값**을 쓴다.
- "마지막 위치 자동 기억"만 있는 GitHub Desktop은 기본이 오염돼 원성이 큼
  (desktop/desktop #1663, #2889). → 이 함정을 피하려고 고정 기본값을 택함.
- VS Code는 **"기본 시드"와 "최근 목록"을 분리** — 고정 기본은 그대로 두고
  일회성 선택은 별개로 취급.

## 구성요소

### 1. 프런트엔드 (`index.html`)

상단 헤더 툴바(기존 관리 버튼 근처)에 `+ 새 세션` 버튼. 클릭 시 인라인 패널:

- **기준 폴더** 경로 표시 — 서버의 기본 폴더 값으로 채움.
- `폴더 선택…` 버튼 → `POST /api/pick-folder` 호출(현재 경로를 seed로 전달).
  선택 시 패널의 경로를 그 값으로 갱신(this-time-only). 취소 시 변화 없음.
- `기본으로 설정` 버튼 → 현재 패널 경로를 `POST /api/new-session-default`로 저장.
- `☑ claude 자동 실행` 체크박스 — 상태를 `localStorage` `csm-new-claude`에 저장/복원.
- 안내문:
  > **📍 여기서 AI가 작업합니다.** 폴더를 정해두면 claude가 그 자리에서 바로 시작해요 — "어디서 작업할까요" 왕복 없이 첫 프롬프트부터 본론으로.
- `열기` 버튼 → `POST /api/new-session` (`{ cwd, claude, mode }`). `mode`는 기존
  `getOpenMode()`(localStorage `csm-open-mode`) 재사용.

패널이 열릴 때 기본 폴더는 `GET`(또는 초기 로드 데이터)로 서버에서 받아 채운다.

### 2. 서버 엔드포인트 (`server.js`)

- **`POST /api/pick-folder`** — body `{ seed }`. PowerShell로 네이티브 폴더
  선택창(`FolderBrowserDialog`)을 `seed` 위치에서 띄우고, 고른 경로를
  `{ path }`로 반환. 취소 시 `{ cancelled: true }`.
- **`GET /api/new-session-default`** — 저장된 기본 폴더 반환. 없으면
  `%USERPROFILE%`로 폴백한 값을 반환.
- **`POST /api/new-session-default`** — body `{ folder }`. `validCwd`로 검증 후
  기본 폴더를 저장(아래 저장 위치 참조).
- **`POST /api/new-session`** — body `{ cwd, claude, mode }`. `validCwd` 검증 후:
  - `claude === true` → `launchInTerminal(cwd, 'claude', mode)`
  - `claude === false` → 그 폴더에서 셸만 여는 빈 터미널

### 3. 기본 폴더 저장 위치

`config.json`의 `newSession.defaultFolder`에 저장한다(원격 키와 같은 "설정"
성격). 안전하게:

- 기존 `config.json`을 읽어 **머지**(특히 `remote` 키 보존) 후 다시 쓴다.
- 쓰기 전 **백업**(`config.json.csm-backup`) — 기존 wt-keybindings 백업 관례를 따름.
- `config.json`이 없으면 `{ "newSession": { "defaultFolder": "..." } }`만 새로
  만든다. 원격 기능은 그대로 꺼진 상태(동작 변화 없음).

### 4. `launchInTerminal` 리팩터 (빈 터미널)

지금은 항상 `cmd /k <claudeCmd>`를 실행한다. `claudeCmd`가 비면 명령 없이
셸만 열도록 분기한다.

- wt + 명령: `wt <openArgs> -d cwd cmd /k claude`
- wt + 빈: `wt <openArgs> -d cwd` (기본 프로필 셸이 cwd에서 열림)
- 비-wt + 빈: `cmd /c start "claude" cmd /k cd /d "cwd"`

## 데이터 흐름

1. 사용자가 `+ 새 세션` 클릭 → 패널 표시, 기본 폴더 채움.
2. (선택) `폴더 선택…` → 서버가 다이얼로그 → 경로 갱신(일회성).
3. (선택) `기본으로 설정` → config.json에 저장.
4. `열기` → `POST /api/new-session` → 서버가 wt/cmd로 터미널 스폰.

## 에러 처리 / 폴백

- 폴더 취소·미존재 → 기존 토스트 안내 재사용, 터미널 안 열림.
- `wt` 미설치 → 기존 `cmd start` 폴백 그대로.
- config.json 파싱 실패 → 백업 남기고 안전하게 실패(사용자에 안내), 원본 훼손 금지.

## 테스트 (`node --test`)

로직을 `lib/new-session.js`로 분리해 OS 상호작용과 떼어 테스트한다(기존
`lib/wt-keybindings.js` + `test/wt-keybindings.test.js` 패턴).

- `buildTerminalArgs({ cwd, claude, mode, hasWt })`: claude on/off·mode·wt 유무에
  따른 커맨드/인자 구성 검증.
- 기본 폴더 머지 로직: 기존 `remote` 키를 보존하면서 `newSession.defaultFolder`만
  갱신되는지, config 없을 때 새로 생성되는지 검증(임시 파일).
- `%USERPROFILE%` 폴백 값 반환 검증.

폴더 다이얼로그와 실제 spawn은 OS 통합이라 단위 테스트에서 제외한다.

## 범위 밖 (YAGNI)

- 첫 프롬프트를 미리 입력받아 claude에 넘기는 기능.
- 여러 "기본 폴더" 프로필/즐겨찾기 목록.
- 최근 폴더 목록(VS Code식) — 이번엔 고정 기본값만.
