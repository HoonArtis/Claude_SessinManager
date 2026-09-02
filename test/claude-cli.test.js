'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { findExecutable, resolveCommand, quoteForCmd } = require('../lib/claude-cli');

const isWin = process.platform === 'win32';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'csm-cli-'));
}

test('PATH에서 실행 파일을 찾는다', () => {
  const dir = tmpdir();
  const exe = path.join(dir, isWin ? 'tool.exe' : 'tool');
  fs.writeFileSync(exe, '');
  const env = { PATH: dir, PATHEXT: '.EXE;.CMD' };
  // Windows는 PATHEXT를 대문자로 이어붙이므로 경로 비교는 대소문자를 무시한다
  assert.strictEqual(String(findExecutable('tool', env)).toLowerCase(), exe.toLowerCase());
});

test('PATH에 없으면 null', () => {
  assert.strictEqual(findExecutable('없는명령어xyz', { PATH: tmpdir(), PATHEXT: '.EXE' }), null);
});

if (isWin) {
  test('claude.exe가 있으면 그대로 실행한다 (cmd 경유 안 함)', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'claude.exe'), '');
    const r = resolveCommand('claude', ['mcp', 'list'], { PATH: dir, PATHEXT: '.EXE;.CMD' });
    assert.strictEqual(r.viaCmd, false);
    assert.match(r.cmd, /claude.exe$/i);
    assert.deepStrictEqual(r.args, ['mcp', 'list']);
  });

  // 이게 핵심 회귀 테스트 — npm -g 설치 PC에는 claude.cmd만 있고,
  // 예전처럼 'claude'를 그대로 spawn하면 ENOENT로 설치가 실패했다.
  test('claude.cmd만 있으면 cmd.exe로 감싸 실행한다', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'claude.cmd'), '');
    const r = resolveCommand('claude', ['mcp', 'list'], { PATH: dir, PATHEXT: '.EXE;.CMD', ComSpec: 'cmd.exe' });
    assert.strictEqual(r.viaCmd, true);
    assert.strictEqual(r.cmd, 'cmd.exe');
    assert.strictEqual(r.args[0], '/d');
    assert.strictEqual(r.args[2], '/c');
    assert.match(r.args[3], /claude.cmd/i);
    assert.match(r.args[3], /mcp list/);
  });

  test('.exe가 .cmd보다 우선한다 (PATHEXT 순서)', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'claude.exe'), '');
    fs.writeFileSync(path.join(dir, 'claude.cmd'), '');
    const r = resolveCommand('claude', [], { PATH: dir, PATHEXT: '.EXE;.CMD' });
    assert.match(r.resolved, /claude.exe$/i);
  });

  test('공백이 든 인자는 따옴표로 감싼다 — env 값에 경로가 들어와도 안 깨진다', () => {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'claude.cmd'), '');
    const r = resolveCommand('claude', ['mcp', 'add', '-e', 'ROOT=C:\\Program Files\\UEFN'], { PATH: dir, PATHEXT: '.CMD', ComSpec: 'cmd.exe' });
    assert.match(r.args[3], /"ROOT=C:\\Program Files\\UEFN"/);
  });
}

test('찾지 못하면 이름을 그대로 돌려준다', () => {
  const r = resolveCommand('없는명령어xyz', ['a'], { PATH: tmpdir(), PATHEXT: '.EXE' });
  assert.strictEqual(r.cmd, '없는명령어xyz');
  assert.strictEqual(r.resolved, null);
  assert.deepStrictEqual(r.args, ['a']);
});

test('quoteForCmd: 특수문자 없는 값은 그대로', () => {
  assert.strictEqual(quoteForCmd('mcp'), 'mcp');
});

test('quoteForCmd: 빈 문자열은 빈 따옴표', () => {
  assert.strictEqual(quoteForCmd(''), '""');
});
