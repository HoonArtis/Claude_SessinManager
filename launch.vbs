' 세션 매니저 실행기 (바탕화면 바로가기용)
' 1) 깃허브에 새 버전이 있으면 받아온다 (실패해도 로컬 버전으로 계속)
' 2) 서버를 창 없이 띄우고 브라우저를 연다. 이미 떠 있으면 새 node가 조용히 종료된다.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c git pull --ff-only >nul 2>&1", 0, True
sh.Run "node server.js", 0, False
WScript.Sleep 1500
sh.Run "http://localhost:7777", 1, False
