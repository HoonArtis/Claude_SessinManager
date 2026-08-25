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
  // 창 이동·배치 (WT 기본 단축키 없음 — 여기서 등록하면 바로 사용 가능)
  { id: 'Terminal.SwapPaneLeft', label: 'Pane 교체: 왼쪽과', defaultKeys: null, group: '창 이동·배치' },
  { id: 'Terminal.SwapPaneRight', label: 'Pane 교체: 오른쪽과', defaultKeys: null, group: '창 이동·배치' },
  { id: 'Terminal.SwapPaneUp', label: 'Pane 교체: 위와', defaultKeys: null, group: '창 이동·배치' },
  { id: 'Terminal.SwapPaneDown', label: 'Pane 교체: 아래와', defaultKeys: null, group: '창 이동·배치' },
  { id: 'Terminal.MoveTabForward', label: '탭 순서: 앞으로', defaultKeys: null, group: '창 이동·배치' },
  { id: 'Terminal.MoveTabBackward', label: '탭 순서: 뒤로', defaultKeys: null, group: '창 이동·배치' },
  { id: 'Terminal.MoveTabToNewWindow', label: '탭을 새 창으로 분리', defaultKeys: null, group: '창 이동·배치' },
  { id: 'Terminal.TogglePaneZoom', label: '현재 pane 전체화면 토글', defaultKeys: null, group: '창 이동·배치' },
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

// 해제(unbind) 항목 인식: 신형 {id:null}과 구형 {command:'unbound'} 둘 다 지원
function isUnbind(k) {
  return k.id === null || k.command === 'unbound';
}

function getKeybindings(text) {
  const json = parseSettings(text);
  const bindings = Array.isArray(json.keybindings) ? json.keybindings : [];
  return SHORTCUTS.map((s) => {
    const override = bindings.find((k) => k.id === s.id);
    if (override) return { ...s, currentKeys: override.keys };
    // 기본 키가 unbind({id:null})되었거나 다른 명령에 재할당됐으면 이 명령은 등록 안 된 상태다
    const defaultShadowed = s.defaultKeys && bindings.some((k) => k.keys === s.defaultKeys);
    return { ...s, currentKeys: defaultShadowed ? null : s.defaultKeys };
  });
}

function setKeybinding(text, id, newKeys) {
  const json = parseSettings(text);
  const bindings = Array.isArray(json.keybindings) ? json.keybindings : [];
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`관리 대상이 아닌 단축키입니다: ${id}`);

  // 같은 id의 기존 오버라이드, 새 키와 충돌하는 바인딩, 이 액션 기본 키의 unbind 항목 제거
  const kept = bindings.filter(
    (k) => k.id !== id && k.keys !== newKeys &&
      !(shortcut.defaultKeys && isUnbind(k) && k.keys === shortcut.defaultKeys),
  );
  kept.push({ id, keys: newKeys });
  // 기본 키가 아닌 키로 바꾸면 내장 기본 키를 unbind해서 새 키만 동작하게 한다.
  // 구버전 WT도 이해하는 command:'unbound' 형식으로 쓴다.
  if (shortcut.defaultKeys && newKeys !== shortcut.defaultKeys) {
    kept.push({ command: 'unbound', keys: shortcut.defaultKeys });
  }
  json.keybindings = kept;
  return JSON.stringify(json, null, 4);
}

// 단축키를 "등록 안 함" 상태로 만든다: 오버라이드 제거 + 내장 기본 키 unbind
function unsetKeybinding(text, id) {
  const json = parseSettings(text);
  const bindings = Array.isArray(json.keybindings) ? json.keybindings : [];
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`관리 대상이 아닌 단축키입니다: ${id}`);

  const kept = bindings.filter((k) => k.id !== id);
  // 기본 키를 다른 명령이 이미 쓰고 있으면 unbind를 추가하지 않는다 (그 명령까지 죽이게 됨)
  if (shortcut.defaultKeys && !kept.some((k) => k.keys === shortcut.defaultKeys)) {
    kept.push({ command: 'unbound', keys: shortcut.defaultKeys });
  }
  json.keybindings = kept;
  return JSON.stringify(json, null, 4);
}

module.exports = { SHORTCUTS, getKeybindings, setKeybinding, unsetKeybinding };
