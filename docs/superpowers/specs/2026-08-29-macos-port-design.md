# Claude 세션 매니저 — macOS 포팅 설계

날짜: 2026-08-29
브랜치: `MAC` (master로 머지하지 않고 이 브랜치에서만 관리)

## 배경

앱은 Windows 전용으로 만들어졌다. `.bat`/`.vbs` 런처, `wt`/`cmd`/`explorer.exe`
실행, `wscript` 재시작, `netsh` 방화벽, Windows Terminal `settings.json` 단축키
편집이 OS에 묶여 있어 macOS에서는 설치도 실행도 되지 않는다.

## 목표

macOS에서 설치(더블클릭) → 실행 → 세션 목록/이어서 작업/폴더 열기까지
Windows와 같은 경험으로 동작한다.

## 비목표 (YAGNI)

- Windows Terminal 단축키 편집의 macOS 대응 (iTerm/Ghostty 키맵 편집) — 안 만든다
- 터미널 분할(split-right / split-down) 모드 — 맥에서는 '새 창'으로 통일
- master 브랜치 머지

## 설계

### 1. 플랫폼 어댑터 — `lib/platform.js`

OS에 의존하는 동작 5개를 어댑터 한 곳으로 모은다. Windows 코드는 로직 변경
없이 그대로 이사한다. 분기는 `process.platform` 런타임 판정이므로 같은
소스가 두 OS에서 동작한다.

| 기능 | win32 | darwin |
|---|---|---|
| 터미널 열기 | `wt` (있으면) / `cmd /c start cmd /k` | Ghostty(`open -na Ghostty --args --working-directory=… -e …`), 없으면 `osascript`로 Terminal.app `do script` |
| 폴더 열기 | `explorer.exe` | `open` (Finder) |
| 서버 재시작 | `wscript restart.vbs` | detached `node server.js` |
| 방화벽 허용 | `netsh` + UAC 승격 | no-op (macOS가 첫 인바운드에서 직접 물어봄) |
| headless claude | `cmd /c claude -p …` | `claude -p …` |

명령어 조립은 `buildTerminalCommand()` 등 **순수 함수**로 분리해서 실제
spawn 없이 argv를 단위 테스트한다.

어댑터는 `capabilities()`도 노출한다: `{ keybindings: boolean, splitModes: boolean }`.

### 2. UI 축소 (`index.html`)

`/api/capabilities`가 내려주는 값으로 맥에서 실체 없는 UI를 숨긴다.

- `[⌨ 터미널 단축키]` 버튼 숨김 (Windows Terminal 전용)
- `[분할 →]` `[분할 ↓]` 모드 버튼 숨김
- "탐색기" 문구 → "Finder"
- 다중 동시열기는 기존 `hasWt === false` 폴백(새 창 여러 개)을 그대로 탄다

### 3. 설치 — `setup.command`

더블클릭 한 번으로:

1. `node` 확인. 없으면 Homebrew로 `brew install node` 할지 물어본다.
2. `Claude 세션 매니저.app` 번들을 생성해 `/Applications`에 배치.
   `Info.plist` + `Contents/MacOS/launch` 셸 스크립트로 구성 — 외부 의존성 0.
   로컬 생성 번들이라 Gatekeeper quarantine이 붙지 않아 바로 열린다.
3. 앱은 7777 점유를 확인해 서버를 띄우고 브라우저를 연다.
   (Spotlight/Dock에서 실행 가능, 터미널 창이 뜨지 않음)

### 4. 테스트

기존 `node --test` 6개 스위트를 유지하고 `test/platform.test.js`를 추가한다.
darwin/win32 각각에서 올바른 argv가 조립되는지 순수 함수로 검증한다.

### 5. 문서

`README.md`에 macOS 설치·실행 섹션을 추가한다.

## 검증 기준

- `node --test` 전부 통과
- `http://localhost:7777`에 세션 목록이 표시된다
- [이어서 작업] → Ghostty 새 창에서 `claude --resume <id>`가 실행된다
- [폴더 열기] → Finder가 해당 폴더를 연다
- `/Applications`의 앱 더블클릭으로 실행된다
- Windows 경로 코드가 회귀하지 않는다 (분기가 런타임 판정이므로 win32 경로 불변)
