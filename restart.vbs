' 업데이트 후 재시작용 — 이전 서버가 포트를 비운 뒤 새 서버를 창 없이 띄운다 (server.js가 호출)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
WScript.Sleep 1200
sh.Run "node server.js", 0, False
