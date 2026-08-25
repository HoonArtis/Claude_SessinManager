# Claude 세션 매니저 — 설계 스펙

날짜: 2026-08-25
상태: 사용자 승인 대기

## 목적

Claude Code 세션이 어떤 폴더에서 작업한 것인지 찾기 어려운 문제를 해결한다.
`~/.claude/projects/` 아래의 세션 기록을 읽어 최근 작업 세션을 한눈에 보여주고,
선택한 세션을 해당 폴더에서 바로 이어서 작업할 수 있게 한다.

## 형태

의존성 없는 단일 Node.js 로컬 웹앱.

- `server.js` — Node 내장 모듈(`http`, `fs`, `path`, `child_process`)만 사용. npm install 불필요.
- `index.html` — 바닐라 JS 단일 페이지. 서버가 정적 파일로 서빙.
- 실행: `node server.js` → 브라우저에서 `http://localhost:7777` 접속.

## 데이터 소스

`%USERPROFILE%\.claude\projects\<인코딩된-폴더명>\<세션ID>.jsonl`

각 jsonl에서 추출하는 필드:

| 필드 | 출처 |
|---|---|
| 세션 ID | 파일명 (또는 레코드의 `sessionId`) |
| 실제 작업 폴더 | 레코드의 `cwd` (폴더명 인코딩이 아닌 실제 경로) |
| 제목 | `ai-title` 레코드. 없으면 첫 사용자 메시지 앞부분으로 대체 |
| 첫/마지막 프롬프트 | `user` 타입 레코드의 첫/마지막 텍스트 |
| 시작/마지막 활동 시각 | `timestamp`가 있는 레코드의 최소/최대값 |
| 메시지 수 | `user` + `assistant` 레코드 수 |
| git 브랜치 | 레코드의 `gitBranch` |

## API

### `GET /api/sessions`

전 프로젝트 폴더의 세션 메타데이터 배열을 마지막 활동 시각 내림차순으로 반환.

- 파싱은 줄 단위 스트림으로 처리 (큰 파일 대비).
- 파일 mtime 기준 인메모리 캐시 — mtime이 같으면 재파싱하지 않음.
- 사용자 메시지가 0개인 빈 세션은 `empty: true`로 표시 (UI에서 기본 숨김).

### `POST /api/resume`  body: `{ sessionId, cwd }`

해당 `cwd`에서 새 터미널 창을 열어 `claude --resume <sessionId>` 실행.

- Windows Terminal(`wt`)이 있으면 `wt -d <cwd> cmd /k claude --resume <id>`
- 없으면 `start cmd /k "cd /d <cwd> && claude --resume <id>"`
- `cwd`가 더 이상 존재하지 않으면 400 에러와 메시지 반환.

## UI (index.html)

- **세션 목록**: 최근 활동순. 각 행에 제목, 실제 폴더 경로, 마지막 활동 시각(상대 시간), 메시지 수.
- **검색창**: 제목·첫/마지막 프롬프트 내용에 대한 실시간 클라이언트 필터.
- **상세 패널**: 세션 클릭 시 우측에 첫/마지막 프롬프트 전문, 작업 기간, git 브랜치, 세션 ID 표시.
- **[이어서 작업] 버튼**: 상세 패널에서 `POST /api/resume` 호출.
- **빈 세션 토글**: 기본 숨김, 체크박스로 표시 가능.

## 에러 처리

- 손상된 jsonl 줄: 해당 줄만 건너뛰고 계속 파싱.
- 읽기 실패한 파일: 목록에서 제외하고 서버 콘솔에 경고.
- resume 실패(폴더 없음, claude 미설치 등): UI에 에러 메시지 표시.

## 테스트

- jsonl 파서(`parseSession`)를 순수 함수로 분리하고, 샘플 jsonl 문자열로
  Node 내장 `node:test` 단위 테스트 작성 (제목 추출, 빈 세션, 손상 줄 처리 등).
- 서버/UI는 수동 확인.

## 범위 제외 (YAGNI)

- 토큰 사용량 통계, 대화 전체 뷰어, 태그, 즐겨찾기, 세션 삭제/아카이브,
  폴더/VS Code 열기 버튼 — 추후 필요 시 추가.
