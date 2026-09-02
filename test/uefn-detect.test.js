'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { uefnLogPath, parseVerseProjectRoot } = require('../lib/uefn-detect');

const norm = (s) => String(s).replace(/\\/g, '/');

test('uefnLogPath: localAppData 기준 표준 경로', () => {
  const p = uefnLogPath({ localAppData: 'C:/Users/ACE/AppData/Local' });
  assert.strictEqual(norm(p), 'C:/Users/ACE/AppData/Local/UnrealEditorFortnite/Saved/Logs/UnrealEditorFortnite.log');
});

test('uefnLogPath: homedir 폴백', () => {
  const p = uefnLogPath({ homedir: 'C:/Users/ACE' });
  assert.strictEqual(norm(p), 'C:/Users/ACE/AppData/Local/UnrealEditorFortnite/Saved/Logs/UnrealEditorFortnite.log');
});

test('parseVerseProjectRoot: .uefnproject에서 Fortnite Projects 상위 폴더', () => {
  const log = [
    'some noise',
    "staging from C:/Users/ACE/문서/Fortnite Projects/MyProject/MyProject.uefnproject loaded",
    'more noise',
  ].join('\n');
  assert.strictEqual(parseVerseProjectRoot(log), 'C:/Users/ACE/문서/Fortnite Projects');
});

test('parseVerseProjectRoot: 여러 개면 마지막(최근) 사용', () => {
  const log = [
    'C:/Old/Fortnite Projects/A/A.uefnproject',
    'D:/New/Fortnite Projects/B/B.uefnproject',
  ].join('\n');
  assert.strictEqual(parseVerseProjectRoot(log), 'D:/New/Fortnite Projects');
});

test('parseVerseProjectRoot: Fortnite Projects 세그먼트 없으면 조부모 폴백', () => {
  const log = 'load C:/Games/Custom/Proj/Proj.uefnproject';
  assert.strictEqual(parseVerseProjectRoot(log), 'C:/Games/Custom');
});

test('parseVerseProjectRoot: 매치 없으면 null', () => {
  assert.strictEqual(parseVerseProjectRoot('no project here'), null);
});
