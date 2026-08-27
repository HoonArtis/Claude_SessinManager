'use strict';
const os = require('node:os');

// 열기 방식 → wt 인자. server.js의 단일 출처.
const OPEN_MODES = {
  window: ['-w', 'new', 'nt'],
  tab: ['-w', '0', 'nt'],
  'split-right': ['-w', '0', 'sp', '-V'],
  'split-down': ['-w', '0', 'sp', '-H'],
};

function normalizeMode(mode) {
  return OPEN_MODES[mode] ? mode : 'tab';
}

// 터미널 실행 cmd/args 구성(순수). command가 falsy면 셸만 연다.
// resume은 command='claude --resume <id>', 새세션 claude on은 'claude', off는 null.
function buildLaunchArgs({ cwd, command, mode, hasWt }) {
  const openArgs = OPEN_MODES[normalizeMode(mode)];
  if (hasWt) {
    const base = [...openArgs, '-d', cwd];
    return { cmd: 'wt', args: command ? [...base, 'cmd', '/k', command] : base };
  }
  const shellCmd = command ? `cd /d "${cwd}" && ${command}` : `cd /d "${cwd}"`;
  return { cmd: 'cmd', args: ['/c', 'start', '"claude"', 'cmd', '/k', shellCmd] };
}

// config.json → 기본 폴더. 없으면 홈 폴더(%USERPROFILE%)로 폴백.
function readDefaultFolder(config) {
  const f = config && config.newSession && config.newSession.defaultFolder;
  return f || os.homedir();
}

// config 객체에 기본 폴더를 머지한 새 객체 반환(원본 불변, 다른 키 보존).
function withDefaultFolder(config, folder) {
  const base = config || {};
  return {
    ...base,
    newSession: { ...(base.newSession || {}), defaultFolder: folder },
  };
}

module.exports = { readDefaultFolder, withDefaultFolder, buildLaunchArgs, OPEN_MODES, normalizeMode };
