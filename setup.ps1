# Claude 세션 매니저 — 바탕화면 바로가기 생성
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = (Get-Command node).Source
$ws = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Claude 세션 매니저.lnk'
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$lnk.Arguments = '"' + (Join-Path $here 'launch.vbs') + '"'
$lnk.WorkingDirectory = $here
$lnk.IconLocation = "$node,0"
$lnk.Description = 'Claude 세션 매니저 - 서버 실행 후 브라우저 열기'
$lnk.Save()

if (Test-Path $lnkPath) {
  Write-Host ''
  Write-Host '설치 완료! 바탕화면의 "Claude 세션 매니저" 아이콘을 더블클릭하면 실행됩니다.'
  Start-Process wscript.exe ('"' + (Join-Path $here 'launch.vbs') + '"')
  Write-Host '지금 첫 실행 중입니다 — 잠시 후 브라우저가 열립니다.'
} else {
  Write-Host '[오류] 바로가기 생성에 실패했습니다.'
  exit 1
}
