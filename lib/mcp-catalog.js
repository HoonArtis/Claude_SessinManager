'use strict';
const fs = require('node:fs');
const path = require('node:path');

// claude mcp add 에 넘길 argv 배열을 만든다(순수).
// stdio: mcp add [-s scope] [-e K=V ...] <id> -- <command> [args...]
// http:  mcp add -t http [-s scope] [-H "K: V" ...] <id> <url>
function buildMcpAddArgs(entry, opts = {}) {
  const scope = opts.scope || 'user';
  if (entry.transport === 'http') {
    const args = ['mcp', 'add', '-t', 'http', '-s', scope];
    for (const h of entry.headers || []) {
      const val = (opts.headerValues || {})[h.key];
      if (val) args.push('-H', `${h.key}: ${val}`);
    }
    args.push(entry.id, entry.url);
    return args;
  }
  const args = ['mcp', 'add', '-s', scope];
  for (const e of entry.env || []) {
    const val = (opts.envValues || {})[e.key];
    if (val) args.push('-e', `${e.key}=${val}`);
  }
  args.push(entry.id, '--', entry.command, ...(entry.args || []));
  return args;
}

// `claude mcp list` 출력에서 설치된 서버 이름 Set 추출.
// 각 줄 형식: "<이름>: <명령/URL> - <상태>"  (이름에 공백 가능)
function parseInstalledMcps(text) {
  const set = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(.+?): .+ - /);
    if (m) set.add(m[1].trim());
  }
  return set;
}

// `claude plugin list` 출력에서 설치된 플러그인 이름 Set 추출.
// 각 줄 형식: "  ❯ <name>@<marketplace>"
function parseInstalledPlugins(text) {
  const set = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/❯\s+([^@\s]+)@/);
    if (m) set.add(m[1]);
  }
  return set;
}

// catalog.json 읽어 { mcp, harness } 반환. 없거나 깨졌으면 빈 배열.
function loadCatalog(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8');
    const j = JSON.parse(raw);
    return {
      mcp: Array.isArray(j.mcp) ? j.mcp : [],
      harness: Array.isArray(j.harness) ? j.harness : [],
    };
  } catch {
    return { mcp: [], harness: [] };
  }
}

// 선택된 하네스들을 새 claude 세션에서 설치하도록 지시하는 프롬프트 생성.
function buildHarnessPrompt(entries) {
  const blocks = entries.map((h) => {
    const steps = (h.steps || []).map((s) => `  - ${s}`).join('\n');
    return `### ${h.name}\n${steps}`;
  });
  return [
    '아래 하네스/플러그인을 설치해줘. 각 항목의 명령을 순서대로 실행하면 돼.',
    '슬래시 명령(/plugin, /impeccable init 등)은 그대로 실행하고, 설치가 끝나면 결과를 알려줘.',
    '',
    ...blocks,
  ].join('\n');
}

module.exports = {
  buildMcpAddArgs,
  parseInstalledMcps,
  parseInstalledPlugins,
  loadCatalog,
  buildHarnessPrompt,
};
