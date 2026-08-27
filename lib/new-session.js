'use strict';
const os = require('node:os');

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

module.exports = { readDefaultFolder, withDefaultFolder };
