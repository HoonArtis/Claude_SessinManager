' launch.bat을 창 없이 실행한다 (바탕화면 바로가기용)
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
bat = fso.GetParentFolderName(WScript.ScriptFullName) & "\launch.bat"
sh.Run """" & bat & """", 0, False
