/**
 * generate-troubleshooter-kb.js
 *
 * 生成 LAWCLAW_TROUBLESHOOTER_KB.md。
 * 配置信息不重复抄写，只指向路径；重点放在应用逻辑和排查方法。
 *
 * 用法: node scripts/generate-troubleshooter-kb.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLIENT_ROOT = path.resolve(__dirname, '..');

function resolveOpenClawRoot() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.openclaw'),
    String.raw`\\wsl.localhost\Ubuntu\home\gnitimg\.openclaw`,
  ];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(home, 'AppData', 'Roaming', 'claw-client', 'lawclaw-config.json'), 'utf8'));
    if (cfg?.paths?.openclawRoot) candidates.unshift(cfg.paths.openclawRoot);
  } catch {}
  for (const c of candidates) {
    try { fs.accessSync(path.join(c, 'openclaw.json')); return c; } catch {}
  }
  return candidates[0];
}

function resolveSkillsDir() {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.agents', 'skills'),
    String.raw`\\wsl.localhost\Ubuntu\home\gnitimg\.agents\skills`,
  ];
  for (const c of candidates) { try { fs.accessSync(c); return c; } catch {} }
  return candidates[0];
}

const OPENCLAW_ROOT = resolveOpenClawRoot();
const AGENTS_DIR = path.join(OPENCLAW_ROOT, 'agents');
const SKILLS_DIR = resolveSkillsDir();
const OUTPUT_PATH = path.join(AGENTS_DIR, 'troubleshooter', 'LAWCLAW_TROUBLESHOOTER_KB.md');

// ── 工具 ──
function readText(p) { try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; } }
function listDirs(p) { try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch { return []; } }
function listFiles(p) { try { return fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name); } catch { return []; } }

// ── 提取：故障模式 ──
function extractFailurePatterns() {
  const patterns = [];
  const seen = new Set();
  for (const f of ['openclawGateway.js', 'openclawNativeRunner.js', 'caseAnalysisRunner.js', 'dependencyDetector.js']) {
    const content = readText(path.join(CLIENT_ROOT, 'src', 'main', 'services', f));
    for (const m of content.matchAll(/throw new Error\(\s*[`'"]([A-Z_]{5,}):\s*([\s\S]*?)[`'"]\s*\)/g)) {
      const code = m[1];
      let desc = m[2].trim().replace(/\$\{[^}]*\}/g, '...').replace(/\s+/g, ' ').slice(0, 80);
      if (!desc || desc === '...' || /\$\{/.test(desc)) desc = '(runtime message)';
      const key = `${code}|${f}`;
      if (!seen.has(key)) { seen.add(key); patterns.push({ code, desc, source: f }); }
    }
  }
  return patterns;
}

// ── 提取：常量 ──
function evalExpr(expr) {
  try { return Function(`"use strict"; return (${expr.replace(/[^0-9+\-*/(). ]/g, '')})`)(); } catch { return NaN; }
}

function extractConstants() {
  const c = {};
  const nr = readText(path.join(CLIENT_ROOT, 'src', 'main', 'services', 'openclawNativeRunner.js'));
  for (const [re, name] of [
    [/const RUN_TIMEOUT_SECONDS\s*=\s*([0-9* +/()-]+);/, 'RUN_TIMEOUT_SECONDS'],
    [/const FORMAL_PRODUCT_DISCOVERY_TIMEOUT_MS\s*=\s*([0-9* +/()-]+);/, 'FORMAL_PRODUCT_DISCOVERY_TIMEOUT_MS'],
    [/const FORMAL_PRODUCT_COMPLETION_TIMEOUT_MS\s*=\s*([0-9* +/()-]+);/, 'FORMAL_PRODUCT_COMPLETION_TIMEOUT_MS'],
    [/const OPENCLAW_TASK_STALL_TIMEOUT_MS\s*=\s*([0-9* +/()-]+);/, 'OPENCLAW_TASK_STALL_TIMEOUT_MS'],
    [/const REVIEWER_TASK_TIMEOUT_MS\s*=\s*([0-9* +/()-]+);/, 'REVIEWER_TASK_TIMEOUT_MS'],
    [/const TROUBLESHOOTER_TASK_TIMEOUT_MS\s*=\s*([0-9* +/()-]+);/, 'TROUBLESHOOTER_TASK_TIMEOUT_MS'],
  ]) { const m = nr.match(re); if (m) { const v = evalExpr(m[1]); if (!isNaN(v)) c[name] = v; } }

  const gw = readText(path.join(CLIENT_ROOT, 'src', 'main', 'services', 'openclawGateway.js'));
  const gwm = gw.match(/const GATEWAY_WARMUP_RETRY_DELAY_MS\s*=\s*([0-9* +/()-]+);/);
  if (gwm) { const v = evalExpr(gwm[1]); if (!isNaN(v)) c.GATEWAY_WARMUP_RETRY_DELAY_MS = v; }

  const cmd = readText(path.join(CLIENT_ROOT, 'src', 'main', 'services', 'commandRunner.js'));
  const dm = cmd.match(/const WSL_DISTRO\s*=\s*'([^']+)'/);
  if (dm) c.WSL_DISTRO = dm[1];
  return c;
}

// ── 提取：pipeline stages ──
function extractPipelineStages() {
  const content = readText(path.join(CLIENT_ROOT, 'src', 'main', 'services', 'caseAnalysisRunner.js'));
  const m = content.match(/const STEP_LIST\s*=\s*\[([\s\S]*?)\]/);
  if (m) return (m[1].match(/'([^']+)'/g) || []).map(s => s.replace(/'/g, ''));
  return [];
}

// ── 提取：核心产品 ──
function extractCoreProducts() {
  const content = readText(path.join(CLIENT_ROOT, 'src', 'main', 'services', 'openclawNativeRunner.js'));
  const m = content.match(/const CORE_PRODUCTS\s*=\s*\[([\s\S]*?)\];/);
  if (!m) return [];
  const items = [];
  const re = /\{\s*type:\s*'([^']+)',\s*label:\s*'([^']+)',\s*file:\s*'([^']+)'\s*\}/g;
  let r;
  while ((r = re.exec(m[1])) !== null) items.push({ type: r[1], label: r[2], file: r[3] });
  return items;
}

// ── 生成 ──
function generate({ failurePatterns, constants, pipelineStages, coreProducts, agentIds }) {
  const L = [];
  const add = (...a) => L.push(...a);
  const h2 = t => add(`## ${t}`, '');
  const h3 = t => add(`### ${t}`, '');
  const p = t => add(t, '');
  const code = (lang, ...c) => add('```' + lang, ...c, '```', '');
  const table = (h, rows) => {
    add(`| ${h.join(' | ')} |`);
    add(`|${h.map(() => '---').join('|')}|`);
    for (const r of rows) add(`| ${r.join(' | ')} |`);
    add('');
  };

  h2('自动生成说明');
  p('> Run `node scripts/generate-troubleshooter-kb.js` to regenerate.');
  p(`> Generated: ${new Date().toISOString()}`);
  add('---', '');

  // ── 1. 去哪找配置 ──
  h2('1. 配置文件位置');
  p('所有配置用相对路径表示，根目录为 `~/.openclaw/`。修理工需要时直接 Read 对应文件。');
  add('');
  table(['配置', '路径', '内容'],
    [
      ['全局配置', '`openclaw.json`', 'Gateway 端口/认证、模型提供商、Agent 列表及模型绑定'],
      ['LawClaw 配置', '`lawclaw.json`', 'RAG (embedding/vectorstore)、OCR 服务、法律工作区路径'],
      ['Agent 配置', '`agents/{id}/agent/agent.json`', '单个 Agent 的模型绑定、指令、角色'],
      ['Agent 模型', '`agents/{id}/agent/models.json`', 'Agent 可用模型列表'],
      ['插件注册', '`plugins/installs.json`', '已安装/启用的 OpenClaw 插件'],
      ['Gateway 凭据', '`openclaw.json` → `gateway.auth.token`', 'Gateway 认证 token'],
    ]
  );

  h3('Agent 工作区');
  table(['Agent', '工作区路径'],
    agentIds.map(id => [id, id === 'main' ? '`workspace/`' : `\`workspace-${id}/\``])
  );
  p('每个工作区包含 `AGENTS.md`、`SOUL.md`、`TOOLS.md` 等人格/指令文件。');
  add('');

  h3('Skills');
  p(`Skills 目录: \`~/.agents/skills/\`（共 ${listDirs(SKILLS_DIR).filter(n => n !== 'shared').length} 个）`);
  p('每个 skill 是一个子目录，包含 `SKILL.md`。');
  add('');

  // ── 2. 应用层逻辑 ──
  h2('2. 应用层如何工作');
  p('应用层 (LawClaw-Client) 是 Electron 桌面应用，负责案件管理和流程编排。');
  p('它本身不生成文书，而是调用 OpenClaw Agent 来完成。');
  add('');

  h3('2.1 通信链路');
  code('text',
    'Renderer (React UI)',
    '  ↓ window.lawclaw.* API（preload.js 暴露）',
    'Electron Main Process',
    '  ↓ IPC handlers（src/main/ipc/*.js）',
    'Services（src/main/services/*.js）',
    '  ↓ wsl.exe -d Ubuntu bash -lc "openclaw ..."',
    'OpenClaw CLI / Gateway（WSL 内）',
  );
  add('');

  h3('2.2 案件分析全流程');
  code('text',
    '用户选目录 + 填要求',
    '  → caseAnalysisRunner 接管',
    '  → [scanning]      扫描案件目录（.pdf/.docx/.wps/.md/.txt/.canvas/.xlsx/.xls/.png/.jpg）',
    '  → [desensitizing] 调用 redact_case.py 脱敏（人名→代号）',
    '  → [indexing]       提取文本（PDF/DOCX 文本抽取，图片走 OCR）',
    '  → [submitting]     构建任务消息（LAWCLAW_TASK.md + 材料路径）',
    '  → [analyzing]      调用 openclaw agent --agent {id} -m "{task}" --json --timeout 1800',
    '  → [drafting]       Agent 在 workspace 中生成五类正式文书',
    '  → [verifying]      检查 delivery 目录文件完整性',
    '  → [delivering]     Markdown → DOCX 转换',
    '  → [cross_review]   调用 reviewer-opponents + reviewer-judge 独立审查',
    '  → [user_review]    等待用户确认',
    '  → [end]            清理临时文件',
  );
  add('');

  h3('2.3 五类核心产品');
  table(['类型', '中文名', '文件名'], coreProducts.map(p => [p.type, p.label, `\`${p.file}\``]));

  h3('2.4 交叉核验机制');
  p('五类产品生成完成后，LawClaw 宿主依次调用:');
  p('1. `reviewer-opponents` — 对方律师视角');
  p('2. `reviewer-judge` — 法官视角');
  p('3. `main` Agent 仲裁 → 生成 `delivery/report.md`');
  add('');
  p('审查产物写入 `.lawclaw/reviews/{reviewer}.md`。');
  p('交付文件底部可含戳记 `核验：通过/不通过 {签名}`。');
  p('一个 reviewer 失败 → `completed_with_issues`；Main 仲裁缺失 → `failed`。');
  add('');

  h3('2.5 Gateway 交互方式');
  code('text',
    '状态检测:  openclaw gateway status --json + openclaw gateway probe --json',
    '启动/停止: openclaw gateway start / stop',
    'Dashboard: openclaw dashboard --no-open → 返回带 token 的 URL',
    'CLI 分析:  openclaw agent --agent {id} -m "{msg}" --json --timeout 1800',
    '事件流:    WebSocket ws://127.0.0.1:18789?token=xxx',
    '',
    '所有 WSL 命令格式: wsl.exe -d Ubuntu bash -lc "export NVM_DIR=\\"$HOME/.nvm\\"; ... && openclaw ..."',
  );
  add('');

  h3('2.6 状态持久化');
  code('text',
    '任务状态:    {outputDir}/.lawclaw/task.json',
    '进度事件:    {outputDir}/.lawclaw/process/case_progress.json',
    '审查报告:    {outputDir}/.lawclaw/reviews/{reviewer}.md',
    '诊断报告:    {outputDir}/.lawclaw/diagnostics/troubleshooter-report.md',
    '对话记录:    {outputDir}/.lawclaw/conversations/{agent}-{ts}.md',
    '降级草稿:    {outputDir}/.lawclaw/fallback/fallback-{product}.md',
    '正式交付:    {outputDir}/delivery/',
    '',
    '应用配置:    %APPDATA%/claw-client/lawclaw-config.json',
    '分析历史:    %APPDATA%/claw-client/history.json',
    '应用日志:    %APPDATA%/claw-client/logs/',
  );
  add('');

  h3('2.7 错误处理策略');
  code('text',
    '原生分析失败 → 写 fallback 调试草稿（不作为正式交付）',
    '模型 API 失败 → 降级为模板草稿',
    'Reviewer 失败 → completed_with_issues，Main 仲裁可继续',
    'Gateway 1006  → 保持上次已知状态，不误报 stopped',
    '敏感信息      → 日志中自动脱敏（api_key/token/password → 前4后4****）',
  );
  add('');

  // ── 3. 常见故障 ──
  h2('3. 常见故障模式');
  p('以下从代码 `throw new Error(...)` 自动提取:');
  add('');
  table(['错误码', '含义', '来源'], failurePatterns.map(f => [`\`${f.code}\``, f.desc, f.source]));
  add('');

  h3('典型故障补充');
  table(['现象', '可能原因', '排查'],
    [
      ['Gateway 连不上', '未启动 / 端口被占 / token 失效', '`openclaw gateway status --json` + `probe --json`'],
      ['Agent 返回 Model override not allowed', 'agent.json 模型绑定不在 openclaw.json providers 中', '对比 `agents/{id}/agent/agent.json` 和 `openclaw.json` → models.providers'],
      ['HTTP 401', 'API key 失效或 provider/model 不匹配', '检查 `openclaw.json` 对应 provider 的 apiKey'],
      ['HTTP 429', '限流', '等或换 provider'],
      ['五类产品不全', 'Agent 返回文字但没写文件', '检查 `delivery/` 目录；可能需 materialization'],
      ['.canvas 无效', '不是合法 JSON 或缺 nodes/edges', '`JSON.parse` 验证'],
      ['Reviewer 未执行', 'agent 不存在或模型绑定错误', '检查 `agents/reviewer-*/agent/agent.json`'],
      ['WSL 命令超时', 'NVM 未加载 / WSL 未响应', '手动 `wsl.exe -d Ubuntu bash -lc "openclaw --version"`'],
      ['openclaw 是 Windows shim', 'PATH 里 /mnt/c/ 的 openclaw 优先', '`command -v openclaw | grep -v /mnt/`'],
    ]
  );
  add('');

  // ── 4. 关键常量 ──
  h2('4. 关键超时');
  table(['常量', '值', '含义'],
    Object.entries(constants)
      .filter(([k]) => !['DEFAULT_GATEWAY_URL', 'WSL_DISTRO'].includes(k))
      .map(([k, v]) => {
        const isSec = k.includes('_SECONDS');
        const ms = isSec ? v * 1000 : v;
        let h = '';
        if (ms >= 3600000) h = `${(ms / 3600000).toFixed(1)}h`;
        else if (ms >= 60000) h = `${(ms / 60000).toFixed(0)}min`;
        else if (ms >= 1000) h = `${(ms / 1000).toFixed(0)}s`;
        return [k, String(v), h];
      })
      .concat([['WSL_DISTRO', constants.WSL_DISTRO || 'Ubuntu', '']])
  );
  add('');

  // ── 5. 排查清单 ──
  h2('5. 排查顺序');
  p('1. WSL: `wsl.exe -l -v` 有 Ubuntu？');
  p('2. CLI: `wsl -d Ubuntu bash -lc "command -v openclaw"` 不是 `/mnt/` shim？');
  p('3. Gateway: 读 `openclaw.json` → gateway 配置；跑 `openclaw gateway status --json`');
  p('4. Agent 配置: 读 `agents/{id}/agent/agent.json`，模型绑定是否在 `openclaw.json` providers 里');
  p('5. Provider: 读 `openclaw.json` → models.providers，URL 可达？key 有效？模型存在？');
  p('6. 任务状态: 读 `.lawclaw/task.json` — status / currentStep / error');
  p('7. 交付文件: `delivery/` 下文件存在？有起草签名？');
  p('8. 审查: `.lawclaw/reviews/` 有无报告？戳记完整？');
  p('9. 日志: `~/.openclaw/logs/` 或 `%APPDATA%/claw-client/logs/`');
  add('');

  return L.join('\n');
}

// ── 主流程 ──
function main() {
  console.log(`OpenClaw root: ${OPENCLAW_ROOT}`);
  console.log(`Output:        ${OUTPUT_PATH}`);

  const agentIds = listDirs(AGENTS_DIR);
  const failurePatterns = extractFailurePatterns();
  const constants = extractConstants();
  const pipelineStages = extractPipelineStages();
  const coreProducts = extractCoreProducts();

  const md = generate({ failurePatterns, constants, pipelineStages, coreProducts, agentIds });

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, md, 'utf8');

  console.log(`Done. ${agentIds.length} agents, ${failurePatterns.length} errors, ${coreProducts.length} products.`);
}

main();
