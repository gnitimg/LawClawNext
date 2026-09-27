/**
 * Sync the lightweight Troubleshooter skill into the configured OpenClaw
 * troubleshooter agent folder.
 *
 * This writes skills/lawclaw-troubleshooter/* and
 * skills/lawclaw-cleanup-rules/SKILL.md, then idempotently appends a short
 * agent.json instruction telling the agent to read the relevant skill first.
 * It does not rewrite LAWCLAW_TROUBLESHOOTER_KB.md, because that file may
 * contain local user edits.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const CLIENT_ROOT = path.resolve(__dirname, '..');
const PROVIDER_DISCOVERY = path.join(CLIENT_ROOT, 'src', 'main', 'services', 'providerDiscovery.js');

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function exists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function resolveOpenClawRoot() {
  const home = os.homedir();
  const config = readJsonIfExists(path.join(home, 'AppData', 'Roaming', 'claw-client', 'lawclaw-config.json'));
  const candidates = [
    process.env.LAWCLAW_OPENCLAW_ROOT,
    config?.paths?.openclawRoot,
    path.join(home, '.openclaw'),
    String.raw`\\wsl.localhost\Ubuntu\home\gnitimg\.openclaw`
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (exists(path.join(candidate, 'openclaw.json')) || exists(path.join(candidate, 'agents', 'troubleshooter'))) {
      return candidate;
    }
  }
  return candidates[0];
}

function resolveTroubleshooterAgentDir(openclawRoot) {
  const candidates = [
    path.join(openclawRoot, 'agents', 'troubleshooter', 'agent'),
    path.join(openclawRoot, 'agents', 'troubleshooter')
  ];
  for (const candidate of candidates) {
    if (exists(path.join(candidate, 'agent.json')) || exists(path.join(candidate, 'AGENTS.md'))) {
      return candidate;
    }
  }
  return candidates[0];
}

function extractSkillPayload() {
  const source = fs.readFileSync(PROVIDER_DISCOVERY, 'utf8');
  const contentMatch = source.match(/const TROUBLESHOOTER_SKILL_CONTENT = (\[[\s\S]*?\])\.join\("\\n"\);/);
  const cleanupContentMatch = source.match(/const CLEANUP_SKILL_CONTENT = (\[[\s\S]*?\])\.join\("\\n"\);/);
  const cleanupDirMatch = source.match(/const CLEANUP_SKILL_DIR = "([^"]+)";/);
  const refsMatch = source.match(/const TROUBLESHOOTER_SKILL_REFS = (\{[\s\S]*?\n\});\n\nfunction applyTroubleshooterAgentProfile/);

  if (!contentMatch || !cleanupContentMatch || !cleanupDirMatch || !refsMatch) {
    throw new Error('Could not extract troubleshooter skill constants from providerDiscovery.js');
  }

  const skillContent = vm.runInNewContext(`${contentMatch[1]}.join("\\n")`);
  const cleanupSkillContent = vm.runInNewContext(`${cleanupContentMatch[1]}.join("\\n")`);
  const refs = vm.runInNewContext(`(${refsMatch[1]})`);
  return {
    skillContent,
    cleanupSkillContent,
    cleanupSkillDir: cleanupDirMatch[1],
    refs
  };
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function syncAgentSkillInstruction(agentDir) {
  const agentJsonPath = path.join(agentDir, 'agent.json');
  const agentJson = readJsonIfExists(agentJsonPath);
  if (!agentJson) return false;

  const skillHint = [
    'LawClaw Troubleshooter context policy:',
    '- Before diagnosing, read skills/lawclaw-troubleshooter/SKILL.md.',
    '- For garbage cleanup or retention questions, read skills/lawclaw-cleanup-rules/SKILL.md.',
    '- Read only the matching refs/ files for the detected failure class.',
    '- Do not load LAWCLAW_TROUBLESHOOTER_KB.md unless the skill references lack a concrete required fact.',
    '- If targeted repair is authorized, use the prompt-provided work directory, logs, task state, and report path as the repair scope.'
  ].join('\n');

  const current = String(agentJson.instructions || '').trim();
  if (current.includes('skills/lawclaw-troubleshooter/SKILL.md')) return false;
  agentJson.instructions = [current, skillHint].filter(Boolean).join('\n\n');
  fs.writeFileSync(agentJsonPath, `${JSON.stringify(agentJson, null, 2)}\n`, 'utf8');
  return true;
}

function main() {
  const openclawRoot = resolveOpenClawRoot();
  const agentDir = resolveTroubleshooterAgentDir(openclawRoot);
  const skillDir = path.join(agentDir, 'skills', 'lawclaw-troubleshooter');
  const { skillContent, cleanupSkillContent, cleanupSkillDir, refs } = extractSkillPayload();

  writeText(path.join(skillDir, 'SKILL.md'), skillContent);
  for (const [relativePath, content] of Object.entries(refs)) {
    writeText(path.join(skillDir, relativePath), content);
  }
  const cleanupSkillPath = path.join(agentDir, cleanupSkillDir, 'SKILL.md');
  writeText(cleanupSkillPath, cleanupSkillContent);
  const agentInstructionUpdated = syncAgentSkillInstruction(agentDir);

  console.log(JSON.stringify({
    ok: true,
    openclawRoot,
    agentDir,
    skillDir,
    cleanupSkillPath,
    refCount: Object.keys(refs).length,
    agentInstructionUpdated
  }, null, 2));
}

main();
