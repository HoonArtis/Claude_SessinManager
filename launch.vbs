' 세션 매니저 실행기 (바탕화면 바로가기용)
' 서버를 즉시 창 없이 띄우고 브라우저를 연다 (이미 떠 있으면 새 node는 조용히 종료).
' 업데이트 확인은 서버가 백그라운드로 하고, 받을지는 페이지에서 사용자가 결정한다.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.js", 0, False
WScript.Sleep 500
sh.Run "http://localhost:7777", 1, False
