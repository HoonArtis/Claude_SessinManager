param([string]$Seed, [string]$Out, [string]$PidFile)
$ErrorActionPreference = 'Stop'
# 재클릭 시 서버가 이 창을 닫을 수 있도록, 느린 컴파일 전에 PID부터 남긴다.
try { [System.IO.File]::WriteAllText($PidFile, [string]$PID) } catch {}
Add-Type -AssemblyName System.Windows.Forms
$cs = @"
using System;
using System.Runtime.InteropServices;
namespace CsmPicker {
  public static class FolderPicker {
    public static string Show(string initialPath, IntPtr owner) {
      var dlg = (IFileOpenDialog)new FileOpenDialog();
      try {
        uint opts; dlg.GetOptions(out opts);
        opts |= 0x20 | 0x40; // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM
        dlg.SetOptions(opts);
        if (!string.IsNullOrEmpty(initialPath)) {
          IShellItem item; Guid g = typeof(IShellItem).GUID;
          if (SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref g, out item) == 0 && item != null)
            dlg.SetFolder(item);
        }
        if (dlg.Show(owner) != 0) return null; // cancelled
        IShellItem result; dlg.GetResult(out result);
        string path; result.GetDisplayName(0x80058000, out path); // SIGDN_FILESYSPATH
        return path;
      } finally { Marshal.ReleaseComObject(dlg); }
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHCreateItemFromParsingName(string p, IntPtr bc, ref Guid riid, out IShellItem ppv);
  }
  [ComImport, ClassInterface(ClassInterfaceType.None), Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
  class FileOpenDialog { }
  [ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr parent);
    void SetFileTypes(uint a, IntPtr b);
    void SetFileTypeIndex(uint i);
    void GetFileTypeIndex(out uint i);
    void Advise(IntPtr e, out uint c);
    void Unadvise(uint c);
    void SetOptions(uint o);
    void GetOptions(out uint o);
    void SetDefaultFolder(IShellItem i);
    void SetFolder(IShellItem i);
    void GetFolder(out IShellItem i);
    void GetCurrentSelection(out IShellItem i);
    void SetFileName(string n);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string n);
    void SetTitle(string t);
    void SetOkButtonLabel(string t);
    void SetFileNameLabel(string t);
    void GetResult(out IShellItem i);
    void AddPlace(IShellItem i, int d);
    void SetDefaultExtension(string e);
    void Close(int hr);
    void SetClientGuid(ref Guid g);
    void ClearClientData();
    void SetFilter(IntPtr f);
    void GetResults(out IntPtr e);
    void GetSelectedItems(out IntPtr e);
  }
  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItem {
    void BindToHandler(IntPtr bc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdn, [MarshalAs(UnmanagedType.LPWStr)] out string name);
    void GetAttributes(uint mask, out uint attribs);
    void Compare(IShellItem psi, uint hint, out int order);
  }
}
"@
Add-Type -TypeDefinition $cs

# 커서가 있는 모니터에 투명 소유자 창을 "다이얼로그 크기만큼" 만들어 화면 중앙에 둔다.
# 다이얼로그는 소유자 창 위에 중앙 정렬되므로 화면 중앙에 뜬다.
$scr = [System.Windows.Forms.Screen]::FromPoint([System.Windows.Forms.Cursor]::Position)
$w = 720; $h = 560
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.FormBorderStyle = 'None'; $owner.Opacity = 0
$owner.StartPosition = 'Manual'; $owner.Width = $w; $owner.Height = $h
$owner.Left = $scr.Bounds.X + [int](($scr.Bounds.Width - $w) / 2)
$owner.Top  = $scr.Bounds.Y + [int](($scr.Bounds.Height - $h) / 2)
$owner.Show(); $owner.Activate()
try { $sel = [CsmPicker.FolderPicker]::Show($Seed, $owner.Handle) } catch { $sel = $null }
$owner.Close()
if ($null -eq $sel) { $sel = '' }
[System.IO.File]::WriteAllText($Out, [string]$sel)
