'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Windows의 spawn은 .cmd/.bat를 직접 실행하지 못한다(ENOENT).
// 공식 설치본은 claude.exe라 그냥 되지만, npm -g로 설치한 PC에는 claude.cmd만 있어
// 'claude'를 그대로 spawn하면 그 PC에서만 설치가 실패한다.
// 그래서 PATH를 직접 뒤져 실제 파일을 찾고, 배치 파일이면 cmd.exe로 감싸 실행한다.
// (shell:true는 인자를 이스케이프 없이 이어붙여 공백·따옴표가 든 값에서 깨지므로 쓰지 않는다.)

const isWin = process.platform === 'win32';

// PATH + PATHEXT를 훑어 실행 파일의 절대경로를 찾는다. 없으면 null.
function findExecutable(name, env = process.env) {
  const pathVal = env.PATH || env.Path || '';
  const dirs = pathVal.split(isWin ? ';' : ':').filter(Boolean);
  const exts = isWin
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (fs.statSync(p).isFile()) return p;
      } catch { /* 다음 후보 */ }
    }
    if (!isWin) continue;
    const bare = path.join(dir, name); // 확장자 없는 파일(예: git-bash용 셸 스크립트)은 건너뛴다
    try { if (fs.statSync(bare).isFile() && path.extname(bare)) return bare; } catch { /* 없음 */ }
  }
  return null;
}

// spawn에 넘길 { cmd, args }를 만든다. 배치 파일이면 cmd.exe /d /s /c 로 감싼다.
// 찾지 못하면 이름 그대로 반환 — 호출부가 ENOENT를 기존과 같이 처리하게 둔다.
function resolveCommand(name, argv = [], env = process.env) {
  const found = findExecutable(name, env);
  if (!found) return { cmd: name, args: argv, resolved: null };
  if (isWin && /\.(cmd|bat)$/i.test(found)) {
    const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
    // /s + 전체를 큰따옴표로 감싸면 경로에 공백이 있어도 cmd가 올바르게 파싱한다.
    const line = [found, ...argv].map(quoteForCmd).join(' ');
    return { cmd: comspec, args: ['/d', '/s', '/c', `"${line}"`], resolved: found, viaCmd: true };
  }
  return { cmd: found, args: argv, resolved: found, viaCmd: false };
}

// cmd.exe에 넘길 인자 하나를 안전하게 감싼다.
function quoteForCmd(arg) {
  const s = String(arg);
  if (s === '') return '""';
  if (!/[\s"^&|<>()%!]/.test(s)) return s;
  return '"' + s.replace(/"/g, '\\"') + '"';
}

module.exports = { findExecutable, resolveCommand, quoteForCmd };
