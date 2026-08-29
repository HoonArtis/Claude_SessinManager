'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  buildTerminalCommand,
  buildOpenFolderCommand,
  buildHeadlessClaudeCommand,
  normalizeMode,
} = require('../lib/platform');

const MAC = { isMac: true };
const WIN = { isMac: false };

test('macOS + Ghostty: 새 창을 작업 폴더에서 열고 명령을 실행한다', () => {
  const { cmd, args } = buildTerminalCommand('/Users/a/proj', 'claude --resume x1', 'tab',
    { ...MAC, terminal: 'ghostty' });
  assert.strictEqual(cmd, 'open');
  assert.ok(args.includes('-na') && args.includes('Ghostty'));
  assert.ok(args.includes('--working-directory=/Users/a/proj'));
  assert.ok(args.some((a) => a.includes('claude --resume x1')));
});

test('macOS + Terminal.app: osascript로 cd 후 명령을 실행한다', () => {
  const { cmd, args } = buildTerminalCommand('/Users/a/proj', 'claude --resume x1', 'window',
    { ...MAC, terminal: 'terminal' });
  assert.strictEqual(cmd, 'osascript');
  assert.strictEqual(args[0], '-e');
  assert.ok(args[1].includes('tell application "Terminal"'));
  assert.ok(args[1].includes("cd '/Users/a/proj'"));
  assert.ok(args[1].includes('claude --resume x1'));
});

test('macOS: 경로의 따옴표가 AppleScript를 깨뜨리지 않는다', () => {
  const { args } = buildTerminalCommand(`/Users/a/it's "odd"`, 'claude', 'window',
    { ...MAC, terminal: 'terminal' });
  const script = args[1];
  // AppleScript do script 인자는 따옴표 하나로 열고 닫혀야 한다
  const unescaped = script.split('\n').find((l) => l.startsWith('do script'))
    .replace(/\\\\/g, '').replace(/\\"/g, '');
  assert.strictEqual((unescaped.match(/"/g) || []).length, 2);
});

test('Windows + wt: 열기 방식 인자를 그대로 넘긴다', () => {
  const { cmd, args } = buildTerminalCommand('C:\\p', 'claude --resume x1', 'split-right',
    { ...WIN, hasWt: true });
  assert.strictEqual(cmd, 'wt');
  assert.deepStrictEqual(args.slice(0, 4), ['-w', '0', 'sp', '-V']);
  assert.ok(args.includes('C:\\p'));
});

test('Windows + wt 없음: cmd start 폴백을 쓴다', () => {
  const { cmd, args } = buildTerminalCommand('C:\\p', 'claude', 'tab', { ...WIN, hasWt: false });
  assert.strictEqual(cmd, 'cmd');
  assert.ok(args.join(' ').includes('cd /d "C:\\p"'));
});

test('폴더 열기: macOS는 open, Windows는 explorer.exe', () => {
  assert.deepStrictEqual(buildOpenFolderCommand('/Users/a', MAC), { cmd: 'open', args: ['/Users/a'] });
  assert.deepStrictEqual(buildOpenFolderCommand('C:\\a', WIN), { cmd: 'explorer.exe', args: ['C:\\a'] });
});

test('headless claude: macOS는 직접, Windows는 cmd /c 경유', () => {
  assert.deepStrictEqual(buildHeadlessClaudeCommand(['-p', '--resume', 'i'], MAC),
    { cmd: 'claude', args: ['-p', '--resume', 'i'] });
  assert.deepStrictEqual(buildHeadlessClaudeCommand(['-p', '--resume', 'i'], WIN),
    { cmd: 'cmd', args: ['/c', 'claude', '-p', '--resume', 'i'] });
});

test('알 수 없는 열기 방식은 tab으로 정규화된다', () => {
  assert.strictEqual(normalizeMode('nope'), 'tab');
  assert.strictEqual(normalizeMode('split-down'), 'split-down');
});
