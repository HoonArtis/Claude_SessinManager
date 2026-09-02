'use strict';
const path = require('node:path');

// UEFN 로그 표준 경로: <LocalAppData>/UnrealEditorFortnite/Saved/Logs/UnrealEditorFortnite.log
// opts.localAppData 우선, 없으면 opts.homedir/AppData/Local.
function uefnLogPath(opts = {}) {
  const base = opts.localAppData || (opts.homedir ? path.join(opts.homedir, 'AppData', 'Local') : null);
  if (!base) return null;
  return path.join(base, 'UnrealEditorFortnite', 'Saved', 'Logs', 'UnrealEditorFortnite.log');
}

// 로그에서 마지막(=최근) *.uefnproject 경로를 찾아 VERSE_PROJECT_ROOT(=Fortnite Projects 상위 폴더)를 반환.
// 'Fortnite Projects' 세그먼트가 있으면 거기까지, 없으면 .uefnproject의 조부모 폴더로 폴백.
function parseVerseProjectRoot(logText) {
  const re = /[A-Za-z]:[\\/][^\r\n"'<>|]*?\.uefnproject/gi;
  const matches = String(logText).match(re);
  if (!matches || !matches.length) return null;
  const p = matches[matches.length - 1].replace(/\\/g, '/');
  const marker = '/fortnite projects';
  const idx = p.toLowerCase().lastIndexOf(marker + '/');
  if (idx !== -1) return p.slice(0, idx + marker.length);
  const parts = p.split('/');
  parts.pop(); // <Project>.uefnproject
  parts.pop(); // <ProjectName> 폴더
  return parts.join('/') || null;
}

module.exports = { uefnLogPath, parseVerseProjectRoot };
