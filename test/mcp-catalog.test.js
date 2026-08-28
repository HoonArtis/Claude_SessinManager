'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  buildMcpAddArgs,
  parseInstalledMcps,
  parseInstalledPlugins,
  loadCatalog,
  buildHarnessPrompt,
} = require('../lib/mcp-catalog');

test('stdio: scope와 -- 구분자, args 포함', () => {
  const entry = { id: 'playwright', transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: [] };
  const argv = buildMcpAddArgs(entry, { scope: 'user' });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-s', 'user', 'playwright', '--', 'npx', '@playwright/mcp@latest']);
});

test('stdio: env 값이 있으면 -e KEY=val 추가', () => {
  const entry = { id: 'github', transport: 'stdio', command: 'npx', args: ['-y', 'srv'], env: [{ key: 'GITHUB_TOKEN' }] };
  const argv = buildMcpAddArgs(entry, { scope: 'project', envValues: { GITHUB_TOKEN: 'ghp_x' } });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-s', 'project', '-e', 'GITHUB_TOKEN=ghp_x', 'github', '--', 'npx', '-y', 'srv']);
});

test('stdio: env 값이 비어 있으면 -e 생략', () => {
  const entry = { id: 'github', transport: 'stdio', command: 'npx', args: [], env: [{ key: 'GITHUB_TOKEN' }] };
  const argv = buildMcpAddArgs(entry, { scope: 'user', envValues: {} });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-s', 'user', 'github', '--', 'npx']);
});

test('http: -t http와 url, 헤더 값 포함', () => {
  const entry = { id: 'sentry', transport: 'http', url: 'https://mcp.sentry.dev/mcp', headers: [{ key: 'Authorization' }] };
  const argv = buildMcpAddArgs(entry, { scope: 'user', headerValues: { Authorization: 'Bearer z' } });
  assert.deepStrictEqual(argv, ['mcp', 'add', '-t', 'http', '-s', 'user', '-H', 'Authorization: Bearer z', 'sentry', 'https://mcp.sentry.dev/mcp']);
});

test('scope 미지정 시 기본 user', () => {
  const entry = { id: 'x', transport: 'stdio', command: 'c', args: [], env: [] };
  const argv = buildMcpAddArgs(entry, {});
  assert.strictEqual(argv[3], 'user');
});

test('parseInstalledMcps: 이름(공백 포함) 추출, 헤더/진단 줄 무시', () => {
  const out = [
    'Checking MCP server health…',
    '',
    'claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication',
    'blender: uvx blender-mcp - ✔ Connected',
    'MCP config diagnostics ⚠',
    '[Conflicting scopes]',
  ].join('\n');
  const set = parseInstalledMcps(out);
  assert.strictEqual(set.has('claude.ai Slack'), true);
  assert.strictEqual(set.has('blender'), true);
  assert.strictEqual(set.has('[Conflicting scopes]'), false);
  assert.strictEqual(set.size, 2);
});

test('parseInstalledPlugins: name@marketplace 에서 name 추출', () => {
  const out = [
    'Installed plugins:',
    '',
    '  ❯ elements-of-style@superpowers-marketplace',
    '    Version: 1.0.0',
    '  ❯ superpowers@superpowers-marketplace',
    '    Status: ✔ enabled',
  ].join('\n');
  const set = parseInstalledPlugins(out);
  assert.strictEqual(set.has('elements-of-style'), true);
  assert.strictEqual(set.has('superpowers'), true);
  assert.strictEqual(set.size, 2);
});

test('loadCatalog: mcp/harness 배열을 반환', () => {
  const cat = loadCatalog(path.join(__dirname, '..'));
  assert.ok(Array.isArray(cat.mcp));
  assert.ok(Array.isArray(cat.harness));
  assert.ok(cat.mcp.length > 0);
});

test('buildHarnessPrompt: 여러 하네스 steps를 병합', () => {
  const entries = [
    { name: 'impeccable', steps: ['/plugin marketplace add pbakaus/impeccable', '/impeccable init'] },
    { name: 'superpowers', steps: ['/plugin install superpowers@superpowers-marketplace'] },
  ];
  const p = buildHarnessPrompt(entries);
  assert.match(p, /impeccable/);
  assert.match(p, /\/plugin marketplace add pbakaus\/impeccable/);
  assert.match(p, /\/impeccable init/);
  assert.match(p, /superpowers@superpowers-marketplace/);
});
