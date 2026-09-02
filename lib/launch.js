'use strict';
const { resolveCommand } = require('./claude-cli');

// 프로세스를 띄우는 모든 경로의 단일 출처.
// 터미널 인자 구성·claude 실행 파일 해석·명령 불변식이 전부 여기 모여 있어서,
// 여기 한 곳만 고치면 새 세션·이어하기·분할열기·MCP 설치·하네스 설치가 함께 바뀐다.
//
// (env 키 입력값은 여기서 다루지 않는다 — 그건 프론트의 ENV 맵과 buildMcpAddArgs 담당.)

// 열기 방식 → wt 인자.
const OPEN_MODES = {
  window: ['-w', 'new', 'nt'],
  tab: ['-w', '0', 'nt'],
  'split-right': ['-w', '0', 'sp', '-V'],
  'split-down': ['-w', '0', 'sp', '-H'],
};

function normalizeMode(mode) {
  return OPEN_MODES[mode] ? mode : 'tab';
}

// 줄바꿈이 든 명령은 Windows 명령줄에서 첫 줄만 전달되고 나머지가 조용히 사라진다.
// (하네스 설치가 "뭘 설치할지 모르는" 상태로 열리던 원인) — 조용히 깨지느니 여기서 막는다.
// 여러 줄 지시는 파일로 써서 "그 파일을 읽어라" 한 줄로 넘길 것.
function assertSingleLine(command) {
  if (command && /[\r\n]/.test(command)) {
    throw new Error('터미널 명령에 줄바꿈을 넣을 수 없습니다. 여러 줄 지시는 파일로 넘기세요.');
  }
  return command;
}

// 터미널 실행 cmd/args 구성(순수). command가 falsy면 셸만 연다.
function buildLaunchArgs({ cwd, command, mode, hasWt }) {
  assertSingleLine(command);
  const openArgs = OPEN_MODES[normalizeMode(mode)];
  if (hasWt) {
    const base = [...openArgs, '-d', cwd];
    return { cmd: 'wt', args: command ? [...base, 'cmd', '/k', command] : base };
  }
  const shellCmd = command ? `cd /d "${cwd}" && ${command}` : `cd /d "${cwd}"`;
  return { cmd: 'cmd', args: ['/c', 'start', '"claude"', 'cmd', '/k', shellCmd] };
}

// wt 한 번 호출로 새 탭 + 분할들을 이어붙인다.
// 2개: 좌|우, 3개: 좌(전체높이)|우상/우하, 4개: 2x2(田) — 4번째는 왼쪽으로 포커스를 옮겨 쪼갠다
function buildMultiPaneArgs(items) {
  const args = [];
  items.forEach((it, i) => {
    if (i > 0) args.push(';');
    if (i === 0) args.push('-w', 'new', 'nt');
    else if (i === 1) args.push('sp', '-V');
    else if (i === 2) args.push('sp', '-H');
    else args.push('mf', 'left', ';', 'sp', '-H');
    args.push('-d', it.cwd, 'cmd', '/k', assertSingleLine(it.command));
  });
  return args;
}

// claude를 직접 실행할 때의 { cmd, args }.
// Windows에서 npm -g로 설치하면 claude.cmd만 있는데 spawn은 .cmd를 직접 못 열어 ENOENT가 난다.
function claudeSpawn(argv, env) {
  return resolveCommand('claude', argv, env);
}

// 터미널 안에서 실행할 claude 명령 문자열. 인자에 줄바꿈이 없어야 한다.
function claudeCommandLine(argsText) {
  return assertSingleLine(`claude ${argsText}`);
}

module.exports = {
  OPEN_MODES,
  normalizeMode,
  assertSingleLine,
  buildLaunchArgs,
  buildMultiPaneArgs,
  claudeSpawn,
  claudeCommandLine,
};
