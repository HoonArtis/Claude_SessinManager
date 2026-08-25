'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SHORTCUTS, getKeybindings, setKeybinding } = require('../lib/wt-keybindings');

const settings = (keybindings) => JSON.stringify({ $schema: 'x', profiles: {}, keybindings });

test('SHORTCUTS에 분할/이동/크기조절/닫기 단축키가 정의되어 있다', () => {
  const ids = SHORTCUTS.map((s) => s.id);
  assert.ok(ids.includes('Terminal.DuplicatePaneAuto'));
  assert.ok(ids.includes('Terminal.SplitPaneDown'));
  assert.ok(ids.includes('Terminal.SplitPaneRight'));
  assert.ok(ids.includes('Terminal.MoveFocusLeft'));
  assert.ok(ids.includes('Terminal.ResizePaneLeft'));
  assert.ok(ids.includes('Terminal.ClosePane'));
});

test('오버라이드가 없으면 기본 키를, 있으면 오버라이드 키를 currentKeys로 반환한다', () => {
  const text = settings([{ id: 'Terminal.DuplicatePaneAuto', keys: 'ctrl+alt+d' }]);
  const list = getKeybindings(text);
  const dup = list.find((s) => s.id === 'Terminal.DuplicatePaneAuto');
  const close = list.find((s) => s.id === 'Terminal.ClosePane');
  assert.strictEqual(dup.currentKeys, 'ctrl+alt+d');
  assert.strictEqual(close.currentKeys, 'ctrl+shift+w');
});

test('BOM과 // 주석이 있어도 파싱한다', () => {
  const text = '﻿' + '{\n// comment\n"keybindings": []\n}';
  const list = getKeybindings(text);
  assert.ok(list.length > 0);
});

test('setKeybinding은 새 항목을 추가하고 기본 키를 unbind한다', () => {
  const text = settings([]);
  const out = JSON.parse(setKeybinding(text, 'Terminal.ClosePane', 'ctrl+alt+w'));
  const entry = out.keybindings.find((k) => k.id === 'Terminal.ClosePane');
  const unbound = out.keybindings.find((k) => k.id === null && k.keys === 'ctrl+shift+w');
  assert.strictEqual(entry.keys, 'ctrl+alt+w');
  assert.ok(unbound, '기본 키 ctrl+shift+w가 unbind되어야 한다');
});

test('setKeybinding은 같은 id의 기존 오버라이드와 새 키와 충돌하는 항목을 제거한다', () => {
  const text = settings([
    { id: 'Terminal.ClosePane', keys: 'ctrl+alt+w' },
    { id: 'Terminal.CopyToClipboard', keys: 'ctrl+alt+q' },
  ]);
  const out = JSON.parse(setKeybinding(text, 'Terminal.ClosePane', 'ctrl+alt+q'));
  const closeEntries = out.keybindings.filter((k) => k.id === 'Terminal.ClosePane');
  assert.strictEqual(closeEntries.length, 1);
  assert.strictEqual(closeEntries[0].keys, 'ctrl+alt+q');
  assert.ok(!out.keybindings.some((k) => k.id === 'Terminal.CopyToClipboard'), '새 키와 충돌하는 기존 바인딩은 제거된다');
});

test('기본 키가 없는 단축키(SwapPane 등)는 currentKeys가 null이고, 설정 시 unbind 항목을 만들지 않는다', () => {
  const text = settings([]);
  const before = getKeybindings(text).find((s) => s.id === 'Terminal.SwapPaneLeft');
  assert.strictEqual(before.currentKeys, null);
  const out = JSON.parse(setKeybinding(text, 'Terminal.SwapPaneLeft', 'ctrl+alt+left'));
  const entry = out.keybindings.find((k) => k.id === 'Terminal.SwapPaneLeft');
  assert.strictEqual(entry.keys, 'ctrl+alt+left');
  assert.ok(!out.keybindings.some((k) => k.id === null), '기본 키가 없으니 unbind 항목이 없어야 한다');
});

test('기본 키로 되돌리면 unbind 항목 없이 오버라이드만 정리된다', () => {
  const text = settings([
    { id: 'Terminal.ClosePane', keys: 'ctrl+alt+w' },
    { id: null, keys: 'ctrl+shift+w' },
  ]);
  const out = JSON.parse(setKeybinding(text, 'Terminal.ClosePane', 'ctrl+shift+w'));
  assert.ok(!out.keybindings.some((k) => k.id === null && k.keys === 'ctrl+shift+w'), '기본 키의 unbind 항목이 제거되어야 한다');
  const entry = out.keybindings.find((k) => k.id === 'Terminal.ClosePane');
  assert.strictEqual(entry.keys, 'ctrl+shift+w');
});
