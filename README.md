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
- [폴더 열기] — 작업 폴더를 탐색기로 열기
- 빈 세션 숨김/표시 토글
- [⌨ 터미널 단축키] — Windows Terminal 분할/이동/닫기 단축키를 앱에서
  변경하면 실제 settings.json에 즉시 반영 (저장 전 자동 백업:
  `settings.json.csm-backup`)

## 테스트

```
node --test
```
