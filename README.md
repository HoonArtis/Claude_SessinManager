# Claude 세션 매니저

`~/.claude/projects/`의 Claude Code 세션 기록을 읽어 최근 작업 세션을
한눈에 보여주고, 클릭 한 번으로 해당 폴더에서 이어서 작업할 수 있는
로컬 웹앱입니다. npm 의존성이 없습니다.

## 설치 (처음 받은 경우)

1. 이 폴더를 원하는 위치에 복사
2. `setup.bat` 더블클릭 — 바탕화면에 "Claude 세션 매니저" 바로가기가
   생기고 바로 실행됩니다

요구사항: Windows + [Node.js](https://nodejs.org). Claude Code가 설치되어
있으면 이어서 작업/세션 초기화 기능까지 전부 사용 가능합니다.

## 실행

바탕화면 바로가기 더블클릭, 또는 `launch.bat` 더블클릭, 또는:

```
node server.js
```

브라우저에서 http://localhost:7777 접속. (서버는 127.0.0.1에만 바인딩되어
외부에서 접근할 수 없습니다.)

## 기능

- 최근 활동순 세션 목록 (제목, 실제 작업 폴더, 마지막 활동, 메시지 수,
  사용 토큰량)
- 제목·프롬프트 내용 검색
- 필터 바 — 기간(전체/오늘/7일/30일), 폴더별, 정렬(최근/메시지/토큰/이름),
  초기화 권장만 보기
- 세션 상세 (첫/마지막 프롬프트, 작업 시간, git 브랜치)
- [+ 새 세션] — 정해둔 기본 폴더(또는 그때 고른 폴더)에서 새 터미널을 열고,
  선택에 따라 claude를 바로 실행. 기본 폴더는 한 번 정하면 고정되고
  (`config.json`의 `newSession.defaultFolder`, 저장 전 자동 백업), claude 자동
  실행 여부는 브라우저에 기억됨
- [이어서 작업] — 해당 폴더에서 새 터미널로 `claude --resume` 실행
- [폴더 열기] — 작업 폴더를 탐색기로 열기
- 빈 세션 숨김/표시 토글
- [⌨ 터미널 단축키] — Windows Terminal 탭/분할/편집/보기 단축키를 앱에서
  변경하면 실제 settings.json에 즉시 반영 (저장 전 자동 백업:
  `settings.json.csm-backup`)
- [삭제] — 삭제 모드에서 세션을 다중 선택해 정리. 완전 삭제가 아니라
  `~/.claude/projects/.csm-trash/`로 이동하므로 되돌릴 수 있음
- [⚡ 세션 초기화 (속도업)] — 컨텍스트가 무거워진 세션(카드에
  "초기화 권장" 배지)을 빠른 새 세션으로 이어가기:
  1. 요청 이력·다음 할 일을 작업 폴더의 `CLAUDE-HANDOFF.md`로 저장
  2. 기존 세션을 `~/.claude/projects/.csm-session-backups/`에 보관
  3. 새 터미널에서 fresh Claude 세션이 핸드오프 문서를 읽고 시작

## 원격 (다른 컴퓨터의 세션 보기·조종)

같은 로컬망의 PC들이 서로의 세션을 보고, 원격으로 터미널을 열고,
프롬프트를 보내 응답을 받아볼 수 있습니다. 기본은 꺼져 있습니다.

**설정 (각 PC에서 1회):**

1. 앱 폴더에 `config.json` 생성 — **모든 PC에 같은 key**를 넣습니다:

   ```json
   { "remote": { "enabled": true, "key": "긴-공유-비밀키", "name": "이 PC 표시이름" } }
   ```

2. 방화벽 허용 (관리자 PowerShell):

   ```
   netsh advfirewall firewall add rule name="CSM TCP" dir=in action=allow protocol=TCP localport=7777
   netsh advfirewall firewall add rule name="CSM UDP" dir=in action=allow protocol=UDP localport=7778
   ```

3. 각 PC에서 세션 매니저 실행 → 몇 초 안에 사이드바 "다른 컴퓨터"에
   서로 나타납니다.

**동작 방식:** 서버가 UDP 7778로 존재를 알리고(자동 발견), 원격 요청은
공유 키가 일치할 때만 허용됩니다. 키는 서버끼리만 주고받고 브라우저에는
내려가지 않습니다. `config.json`이 없으면 서버는 예전처럼 127.0.0.1
전용으로 떠서 외부 접근이 불가능합니다.

**원격 프롬프트:** 원격 세션 상세의 채팅창에 입력하면 그쪽 PC에서
`claude -p --resume`으로 해당 세션에 이어서 실행되고 결과가 스트리밍으로
돌아옵니다 (Ctrl+Enter 전송).

## 테스트

```
node --test
```
