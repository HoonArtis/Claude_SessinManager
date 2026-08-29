'use strict';
// OS에 의존하는 동작을 한곳에 모은 어댑터.
// 분기는 런타임(process.platform) 판정이라 같은 소스가 Windows/macOS 양쪽에서 돈다.
const path = require('node:path');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');

const IS_MAC = process.platform === 'darwin';

// --- Windows Terminal 존재 여부 (win32 전용) ---
const hasWt = !IS_MAC && spawnSync('where', ['wt'], { windowsHide: true }).status === 0;

// --- macOS에서 쓸 터미널 앱 고르기: Ghostty 우선, 없으면 Terminal.app ---
const GHOSTTY_APP = '/Applications/Ghostty.app';
function macTerminalApp() {
  return fs.existsSync(GHOSTTY_APP) ? 'ghostty' : 'terminal';
}

// 열기 방식: window(새 창) / tab(기존 창 새 탭) / split-right / split-down
const OPEN_MODES = {
  window: ['-w', 'new', 'nt'],
  tab: ['-w', '0', 'nt'],
  'split-right': ['-w', '0', 'sp', '-V'],
  'split-down': ['-w', '0', 'sp', '-H'],
};

function normalizeMode(mode) {
  return OPEN_MODES[mode] ? mode : 'tab';
}

// AppleScript 문자열 리터럴 이스케이프 (백슬래시 먼저, 그다음 따옴표)
function escAppleScript(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// POSIX 셸 작은따옴표 인용
function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

// 터미널에서 cwd로 이동해 claudeCmd를 실행하는 argv를 만든다 (spawn 없이 테스트 가능).
// platform/terminal은 테스트에서 주입한다.
function buildTerminalCommand(cwd, claudeCmd, mode, opts = {}) {
  const isMac = opts.isMac !== undefined ? opts.isMac : IS_MAC;
  if (!isMac) {
    const wt = opts.hasWt !== undefined ? opts.hasWt : hasWt;
    if (wt) {
      return { cmd: 'wt', args: [...OPEN_MODES[normalizeMode(mode)], '-d', cwd, 'cmd', '/k', claudeCmd] };
    }
    return { cmd: 'cmd', args: ['/c', 'start', '"claude"', 'cmd', '/k', `cd /d "${cwd}" && ${claudeCmd}`] };
  }
  // macOS — 분할/탭 모드는 지원하지 않고 항상 새 창으로 연다
  const term = opts.terminal || macTerminalApp();
  if (term === 'ghostty') {
    return {
      cmd: 'open',
      args: ['-na', 'Ghostty', '--args', `--working-directory=${cwd}`, '-e', 'zsh', '-lc', `${claudeCmd}; exec zsh -l`],
    };
  }
  const script = `tell application "Terminal"
activate
do script "cd ${escAppleScript(shellQuote(cwd))} && ${escAppleScript(claudeCmd)}"
end tell`;
  return { cmd: 'osascript', args: ['-e', script] };
}

// 폴더를 파일 탐색기로 여는 argv
function buildOpenFolderCommand(dir, opts = {}) {
  const isMac = opts.isMac !== undefined ? opts.isMac : IS_MAC;
  return isMac ? { cmd: 'open', args: [dir] } : { cmd: 'explorer.exe', args: [dir] };
}

// headless claude(`claude -p --resume …`) 실행 argv.
// Windows는 claude가 .cmd 셸 스크립트라 cmd /c를 거쳐야 하고, macOS는 직접 부른다.
function buildHeadlessClaudeCommand(claudeArgs, opts = {}) {
  const isMac = opts.isMac !== undefined ? opts.isMac : IS_MAC;
  return isMac
    ? { cmd: 'claude', args: [...claudeArgs] }
    : { cmd: 'cmd', args: ['/c', 'claude', ...claudeArgs] };
}

// 맥에는 Windows Terminal 단축키 편집도, 분할 모드도 대응 기능이 없다.
function capabilities() {
  return { platform: process.platform, keybindings: !IS_MAC, splitModes: hasWt };
}

function makeAdapter({ dirname, env }) {
  function launchInTerminal(cwd, claudeCmd, mode) {
    const { cmd, args } = buildTerminalCommand(cwd, claudeCmd, mode);
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', env });
    child.unref();
  }

  function openFolder(dir) {
    const { cmd, args } = buildOpenFolderCommand(dir);
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  }

  // macOS는 첫 인바운드 연결에서 OS가 직접 방화벽 허용을 묻는다 — 앱이 할 일이 없다.
  function tryFirewallElevated() {
    if (IS_MAC) return;
    const rules = 'netsh advfirewall firewall add rule name=CSM_TCP_7777 dir=in action=allow protocol=TCP localport=7777 remoteip=localsubnet & netsh advfirewall firewall add rule name=CSM_UDP_7778 dir=in action=allow protocol=UDP localport=7778 remoteip=localsubnet';
    try {
      const child = spawn('powershell', ['-WindowStyle', 'Hidden', '-Command',
        `Start-Process cmd -ArgumentList '/c ${rules}' -Verb RunAs -WindowStyle Hidden`,
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
    } catch { /* 사용자가 UAC를 거부해도 치명적이지 않음 */ }
  }

  // 새 코드로 재시작 (업데이트/페어링 공용)
  function restartSelf() {
    setTimeout(() => {
      if (IS_MAC) {
        // 포트가 비워지길 기다렸다가 새 서버를 detached로 띄운다 (restart.vbs 대응)
        const child = spawn(process.execPath, [path.join(dirname, 'server.js')], {
          cwd: dirname, detached: true, stdio: 'ignore', env,
        });
        child.unref();
      } else {
        const child = spawn('wscript', [path.join(dirname, 'restart.vbs')], {
          cwd: dirname, detached: true, stdio: 'ignore',
        });
        child.unref();
      }
      process.exit(0);
    }, IS_MAC ? 1200 : 300);
  }

  return { launchInTerminal, openFolder, tryFirewallElevated, restartSelf };
}

module.exports = {
  IS_MAC,
  hasWt,
  OPEN_MODES,
  normalizeMode,
  buildTerminalCommand,
  buildOpenFolderCommand,
  buildHeadlessClaudeCommand,
  capabilities,
  makeAdapter,
};
