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

// 설치가 실패했을 때 그 자리에서 claude를 띄워 넘길 프롬프트.
// 실행한 명령과 실제 에러를 그대로 붙여줘야 원인을 짚을 수 있다.
function buildInstallFixPrompt(failures) {
  const blocks = (failures || []).map((f) => [
    `### ${f.name || f.id}`,
    '실행한 명령:',
    '```',
    f.command || '(알 수 없음)',
    '```',
    '에러:',
    '```',
    String(f.message || '(메시지 없음)').trim(),
    '```',
  ].join('\n'));
  return [
    '아래 MCP 서버 설치가 실패했어. 에러를 보고 원인을 찾아서 설치까지 끝내줘.',
    '',
    '확인할 것:',
    '- 같은 이름의 서버가 이미 있으면 claude mcp list로 확인하고, 필요하면 지운 뒤 다시 설치',
    '- uvx/npx 같은 실행기가 없으면 먼저 설치 (uv는 winget install astral-sh.uv)',
    '- 필요한 환경변수가 비어 있으면 무엇이 필요한지 알려주고 값을 받아서 설치',
    '',
    '끝나면 claude mcp list로 정상 연결됐는지 확인하고 결과를 알려줘.',
    '',
    ...blocks,
  ].join('\n');
}

module.exports = {
  buildMcpAddArgs,
  parseInstalledMcps,
  parseInstalledPlugins,
  buildInstallFixPrompt,
  loadCatalog,
  buildHarnessPrompt,
};
