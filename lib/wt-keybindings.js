'use strict';

// Windows Terminal 기본 단축키 중 이 앱에서 관리하는 항목.
// defaultKeys는 WT defaults.json의 내장 기본값이다.
const SHORTCUTS = [
  // 탭 관리
  { id: 'Terminal.OpenNewTab', label: '새 탭', defaultKeys: 'ctrl+shift+t', group: '탭 관리' },
  { id: 'Terminal.DuplicateTab', label: '현재 탭 복제', defaultKeys: 'ctrl+shift+d', group: '탭 관리' },
  { id: 'Terminal.NextTab', label: '다음 탭', defaultKeys: 'ctrl+tab', group: '탭 관리' },
  { id: 'Terminal.PrevTab', label: '이전 탭', defaultKeys: 'ctrl+shift+tab', group: '탭 관리' },
  // 창·분할
  { id: 'Terminal.OpenNewWindow', label: '새 창', defaultKeys: 'ctrl+shift+n', group: '창·분할' },
  { id: 'Terminal.DuplicatePaneAuto', label: '현재 탭 자동 분할 (복제)', defaultKeys: 'alt+shift+d', group: '창·분할' },
  { id: 'Terminal.SplitPaneDown', label: '아래로 분할 (가로선)', defaultKeys: 'alt+shift+minus', group: '창·분할' },
  { id: 'Terminal.SplitPaneRight', label: '오른쪽으로 분할 (세로선)', defaultKeys: 'alt+shift+plus', group: '창·분할' },
  { id: 'Terminal.MoveFocusLeft', label: '분할 창 이동: 왼쪽', defaultKeys: 'alt+left', group: '창·분할' },
  { id: 'Terminal.MoveFocusRight', label: '분할 창 이동: 오른쪽', defaultKeys: 'alt+right', group: '창·분할' },
  { id: 'Terminal.MoveFocusUp', label: '분할 창 이동: 위', defaultKeys: 'alt+up', group: '창·분할' },
  { id: 'Terminal.MoveFocusDown', label: '분할 창 이동: 아래', defaultKeys: 'alt+down', group: '창·분할' },
  { id: 'Terminal.ResizePaneLeft', label: '분할 창 크기: 왼쪽', defaultKeys: 'alt+shift+left', group: '창·분할' },
  { id: 'Terminal.ResizePaneRight', label: '분할 창 크기: 오른쪽', defaultKeys: 'alt+shift+right', group: '창·분할' },
  { id: 'Terminal.ResizePaneUp', label: '분할 창 크기: 위', defaultKeys: 'alt+shift+up', group: '창·분할' },
  { id: 'Terminal.ResizePaneDown', label: '분할 창 크기: 아래', defaultKeys: 'alt+shift+down', group: '창·분할' },
  { id: 'Terminal.ClosePane', label: '현재 창(pane) 닫기', defaultKeys: 'ctrl+shift+w', group: '창·분할' },
  // 편집·검색
  { id: 'Terminal.CopyToClipboard', label: '복사', defaultKeys: 'ctrl+shift+c', group: '편집·검색' },
  { id: 'Terminal.PasteFromClipboard', label: '붙여넣기', defaultKeys: 'ctrl+shift+v', group: '편집·검색' },
  { id: 'Terminal.FindText', label: '찾기', defaultKeys: 'ctrl+shift+f', group: '편집·검색' },
  // 보기
  { id: 'Terminal.ToggleFullscreen', label: '전체 화면 전환', defaultKeys: 'f11', group: '보기' },
  { id: 'Terminal.OpenSettingsUI', label: '설정 열기', defaultKeys: 'ctrl+,', group: '보기' },
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
