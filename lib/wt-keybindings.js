'use strict';

// Windows Terminal 기본 단축키 중 이 앱에서 관리하는 항목.
// defaultKeys는 WT defaults.json의 내장 기본값이다.
const SHORTCUTS = [
  { id: 'Terminal.DuplicatePaneAuto', label: '현재 탭 자동 분할 (복제)', defaultKeys: 'alt+shift+d' },
  { id: 'Terminal.SplitPaneDown', label: '아래로 분할 (가로선)', defaultKeys: 'alt+shift+minus' },
  { id: 'Terminal.SplitPaneRight', label: '오른쪽으로 분할 (세로선)', defaultKeys: 'alt+shift+plus' },
  { id: 'Terminal.MoveFocusLeft', label: '분할 창 이동: 왼쪽', defaultKeys: 'alt+left' },
  { id: 'Terminal.MoveFocusRight', label: '분할 창 이동: 오른쪽', defaultKeys: 'alt+right' },
  { id: 'Terminal.MoveFocusUp', label: '분할 창 이동: 위', defaultKeys: 'alt+up' },
  { id: 'Terminal.MoveFocusDown', label: '분할 창 이동: 아래', defaultKeys: 'alt+down' },
  { id: 'Terminal.ResizePaneLeft', label: '분할 창 크기: 왼쪽', defaultKeys: 'alt+shift+left' },
  { id: 'Terminal.ResizePaneRight', label: '분할 창 크기: 오른쪽', defaultKeys: 'alt+shift+right' },
  { id: 'Terminal.ResizePaneUp', label: '분할 창 크기: 위', defaultKeys: 'alt+shift+up' },
  { id: 'Terminal.ResizePaneDown', label: '분할 창 크기: 아래', defaultKeys: 'alt+shift+down' },
  { id: 'Terminal.ClosePane', label: '현재 창(pane) 닫기', defaultKeys: 'ctrl+shift+w' },
];

// WT settings.json은 BOM과 // 주석을 포함할 수 있다 (JSONC).
function parseSettings(text) {
  const clean = text
    .replace(/^﻿/, '')
    .replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(clean);
}

function getKeybindings(text) {
  const json = parseSettings(text);
  const bindings = Array.isArray(json.keybindings) ? json.keybindings : [];
  return SHORTCUTS.map((s) => {
    const override = bindings.find((k) => k.id === s.id);
    return { ...s, currentKeys: override ? override.keys : s.defaultKeys };
  });
}

function setKeybinding(text, id, newKeys) {
  const json = parseSettings(text);
  const bindings = Array.isArray(json.keybindings) ? json.keybindings : [];
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`관리 대상이 아닌 단축키입니다: ${id}`);

  // 같은 id의 기존 오버라이드, 새 키와 충돌하는 바인딩, 이 액션 기본 키의 unbind 항목 제거
  const kept = bindings.filter(
    (k) => k.id !== id && k.keys !== newKeys && !(k.id === null && k.keys === shortcut.defaultKeys),
  );
  kept.push({ id, keys: newKeys });
  // 기본 키가 아닌 키로 바꾸면 내장 기본 키를 unbind해서 새 키만 동작하게 한다
  if (newKeys !== shortcut.defaultKeys) {
    kept.push({ id: null, keys: shortcut.defaultKeys });
  }
  json.keybindings = kept;
  return JSON.stringify(json, null, 4);
}

module.exports = { SHORTCUTS, getKeybindings, setKeybinding };
