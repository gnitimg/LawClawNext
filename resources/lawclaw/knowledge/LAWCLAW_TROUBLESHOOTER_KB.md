# LawClaw Troubleshooter Knowledge Base

> **AUTO-GENERATED** — Run `node scripts/generate-troubleshooter-kb.js` to regenerate.

> Generated at: 2026-06-14T11:26:56.867Z

---

## 1. Project Overview

LawClaw is a legal case analysis system with two layers:

- **Application Layer (LawClaw-Client)**: Electron/Vite desktop app on Windows

  - Source: `D:\ProjectCode\LawClaw-Client`

- **OpenClaw Layer**: AI agent runtime in WSL Ubuntu

  - Root: `~/.openclaw` (UNC: `\\wsl.localhost\Ubuntu\home\gnitimg\.openclaw`)

  - Skills: `~/.agents/skills`


## 2. Application Layer

### 2.1 Services (30)

`apiTester`, `caseAnalysisRunner`, `caseCleanupService`, `caseOutputPaths`, `caseScanner`, `commandRunner`, `configStore`, `deliveryScanner`, `dependencyDetector`, `dependencyInstaller`, `developerLogger`, `documentPromptBuilder`, `documentStreamParser`, `historyStore`, `logger`, `materialExtractor`, `mcpServiceStore`, `ocrService`, `openclawGateway`, `openclawGatewayEventBridge`, `openclawNativeRunner`, `openclawPathResolver`, `privacyRedactionService`, `providerDiscovery`, `resourcePolicy`, `secretStore`, `skillManager`, `sourceStore`, `statusPollingService`, `timezoneService`


### 2.2 IPC Channels (87)

| Channel | Source File |
|---|---|
| case:scanCases | caseIpc.js |
| case:scanVolumes | caseIpc.js |
| case:startAnalysis | caseIpc.js |
| case:getPipelineStatus | caseIpc.js |
| case:cancelAnalysis | caseIpc.js |
| case:sendMessageToRunning | caseIpc.js |
| case:routeUserMessage | caseIpc.js |
| case:diagnoseFailure | caseIpc.js |
| case:cleanupArtifacts | caseIpc.js |
| case:openOutputDir | caseIpc.js |
| case:exportDocx | caseIpc.js |
| case:exportPdf | caseIpc.js |
| delivery:listFiles | deliveryIpc.js |
| delivery:readFile | deliveryIpc.js |
| delivery:openFile | deliveryIpc.js |
| delivery:openDirectory | deliveryIpc.js |
| dependency:check | dependencyIpc.js |
| dependency:checkAll | dependencyIpc.js |
| dependency:install | dependencyIpc.js |
| dependency:updatePath | dependencyIpc.js |
| dependency:openPath | dependencyIpc.js |
| dependency:selectPath | dependencyIpc.js |
| history:list | historyIpc.js |
| history:get | historyIpc.js |
| history:create | historyIpc.js |
| history:update | historyIpc.js |
| history:delete | historyIpc.js |
| history:clear | historyIpc.js |
| openclaw:getStatus | openclawIpc.js |
| openclaw:startGateway | openclawIpc.js |
| openclaw:openDashboard | openclawIpc.js |
| openclaw:stopGateway | openclawIpc.js |
| openclaw:refreshGateway | openclawIpc.js |
| openclaw:status | openclawIpc.js |
| openclaw:start | openclawIpc.js |
| openclaw:stop | openclawIpc.js |
| openclaw:writeAgentConfig | openclawIpc.js |
| openclaw:runCaseAnalysis | openclawIpc.js |
| openclaw:getTaskStatus | openclawIpc.js |
| openclaw:cancelTask | openclawIpc.js |
| openclaw:connectGatewayEvents | openclawIpc.js |
| openclaw:disconnectGatewayEvents | openclawIpc.js |
| openclaw:getGatewayEventsStatus | openclawIpc.js |
| settings:get | settingsIpc.js |
| settings:update | settingsIpc.js |
| settings:selectDirectory | settingsIpc.js |
| settings:updatePath | settingsIpc.js |
| settings:openDirectory | settingsIpc.js |
| settings:checkDependency | settingsIpc.js |
| settings:openDownloadUrl | settingsIpc.js |
| settings:testProvider | settingsIpc.js |
| skills:discover | settingsIpc.js |
| skills:scanRoot | settingsIpc.js |
| skills:importFolder | settingsIpc.js |
| skills:openFolder | settingsIpc.js |
| mcp:saveServices | settingsIpc.js |
| mcp:deleteService | settingsIpc.js |
| mcp:testService | settingsIpc.js |
| mcp:discover | settingsIpc.js |
| ocr:readConfig | settingsIpc.js |
| ocr:saveConfig | settingsIpc.js |
| ocr:testProvider | settingsIpc.js |
| settings:testConfigService | settingsIpc.js |
| settings:testAgent | settingsIpc.js |
| model:testConnection | settingsIpc.js |
| provider:discover | settingsIpc.js |
| provider:refresh | settingsIpc.js |
| provider:applyDiscovered | settingsIpc.js |
| provider:readOpenClawConfig | settingsIpc.js |
| provider:saveOpenClawConfig | settingsIpc.js |
| provider:testOpenClawProvider | settingsIpc.js |
| provider:testOpenClawModel | settingsIpc.js |
| provider:upsertOpenClawModelProvider | settingsIpc.js |
| provider:deleteOpenClawModelProvider | settingsIpc.js |
| provider:openOpenClawConfig | settingsIpc.js |
| provider:openOpenClawConfigDir | settingsIpc.js |
| provider:openAgentDir | settingsIpc.js |
| sources:list | sourceIpc.js |
| sources:getByCase | sourceIpc.js |
| sources:create | sourceIpc.js |
| sources:update | sourceIpc.js |
| sources:delete | sourceIpc.js |
| status:startPolling | statusPollingIpc.js |
| status:stopPolling | statusPollingIpc.js |
| status:getLatest | statusPollingIpc.js |
| status:getStepLabels | statusPollingIpc.js |
| status:getProductLabels | statusPollingIpc.js |

### 2.3 Renderer Pages (8)

`AdvancedDebugPage`, `CaseWorkspacePage`, `DeliveryPage`, `HistoryPage`, `HomePage`, `PipelinePage`, `SettingsPage`, `SourcesPage`


### 2.4 Renderer Services (12)

`caseSessionService`, `debugService`, `deliveryService`, `dependencyService`, `historyService`, `modelService`, `openclawService`, `pipelineService`, `settingsService`, `sourcesService`, `statusPollingRendererService`, `types`


### 2.5 Shared Types (9)

`caseSession`, `files`, `legalPromptRegistry`, `modelCapabilities`, `openclawConfigModel`, `pathDisplay`, `pipeline`, `result`, `settings`


## 3. OpenClaw Layer Structure

### 3.1 Root Directory

```text
~/.openclaw/
├── openclaw.json          # Gateway + models + agents config
├── lawclaw.json           # RAG + OCR + legal workspace config
├── agents/                # Agent definitions
│   └── {agentId}/
│       ├── agent/agent.json
│       ├── agent/models.json
│       └── sessions/
├── workspace/             # Main agent workspace
├── workspace-{agentId}/   # Per-agent workspaces
├── plugins/installs.json  # Plugin registry
├── plugin-skills/
├── flows/
├── tasks/
├── subagents/
├── logs/
├── memory/
├── temp/
└── ...
```


## 4. Agent System

### 4.1 Agent Definitions (from openclaw.json)

| Agent ID | Primary Model | Fallbacks |
|---|---|---|

### 4.2 Agent Details (from agent.json files)

### 4.3 Workspace Mapping

| Agent ID | Workspace |
|---|---|

## 5. Model Providers

## 6. Gateway Configuration

### 6.1 Settings (from openclaw.json)

```json
{}
```

### 6.2 Key Points

- Default URL: `http://127.0.0.1:18789`

- Auth mode: token-based

- State persisted to `lawclaw-config.json` under `openclaw` key

- Tokens encrypted via Electron `safeStorage`

- WebSocket event bridge for real-time task updates


## 7. Pipeline Architecture

### 7.1 Stages

```text
scanning → desensitizing → indexing → submitting → analyzing → drafting → verifying_sources → delivering_docx → cross_review → user_review → garbage_cleanup → end
```

### 7.2 Core Products

| Type | Label | File |
|---|---|---|
| case_analysis_report | 案件分析报告 | `案件分析报告.md` |
| defense_opinion | 辩护意见书 | `辩护意见书.md` |
| opponent_strategy | 对方策略预判 | `对方策略预判.md` |
| cross_examination | 质证意见 | `质证意见.md` |
| knowledge_graph | 知识图谱 | `知识图谱.canvas` |

## 8. File Paths & Directories

### 8.1 Application Config

- Settings: `%APPDATA%/claw-client/lawclaw-config.json`

- Logs: `%APPDATA%/claw-client/logs/`

- History: `%APPDATA%/claw-client/history.json`


### 8.2 OpenClaw Config

- Main: `~/.openclaw/openclaw.json`

- LawClaw: `~/.openclaw/lawclaw.json`

- Agents: `~/.openclaw/agents/{agentId}/agent/agent.json`


### 8.3 Case Output Structure

```text
{outputDir}/
├── .lawclaw/
│   ├── task.json
│   ├── process/case_progress.json
│   ├── privacy/{redacted,mapping,meta,report}.json
│   ├── extracted/materials.json
│   ├── reviews/{reviewer}.md + report.md
│   ├── diagnostics/troubleshooter-report.md
│   ├── conversations/{agent}-{timestamp}.md
│   ├── fallback/fallback-{product}.md
│   └── source-records.json
├── delivery/
│   ├── 案件分析报告.md
│   ├── 辩护意见书.md
│   ├── 对方策略预判.md
│   ├── 质证意见.md
│   ├── 知识图谱.canvas
│   └── report.md
```


## 9. Available Skills (31)

`brainstorming`, `civil-complaint`, `civil-defense-statement`, `clawhub-skill-vetting`, `dispatching-parallel-agents`, `executing-plans`, `figma-generate-design`, `find-skills`, `finishing-a-development-branch`, `frontend-design`, `huashu-design`, `json-canvas`, `legal-analysis-quality`, `legal-assistant`, `obsidian-bases`, `obsidian-markdown`, `opponent-prediction`, `prototype`, `receiving-code-review`, `requesting-code-review`, `self-improving-agent`, `subagent-driven-development`, `summarize`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `web-design-guidelines`, `writing-plans`, `writing-skills`


## 10. OpenClaw Plugins (0)

### Enabled (0)




### Disabled (0)




## 11. Failure Patterns (from code)

| Error Code | Description | Source |
|---|---|---|
| `OPENCLAW_AGENT_SYNC_FAILED` | ${error.message} | openclawNativeRunner.js |
| `OPENCLAW_NATIVE_UNAVAILABLE` | 未检测到可用 OpenClaw CLI | openclawNativeRunner.js |
| `OPENCLAW_NATIVE_UNAVAILABLE` | 未检测到可用 OpenClaw CLI | openclawNativeRunner.js |
| `OPENCLAW_GATEWAY_START_FAILED` | ${redactChunk(start.stderr || start.stdout)} | openclawNativeRunner.js |
| `OPENCLAW_GATEWAY_START_FAILED` | ${redactChunk(start.stderr || start.stdout)} | openclawNativeRunner.js |
| `LAWCLAW_TASK_WRITE_FAILED` | ${redactChunk(copyResult.stderr || copyResult.stdout)} | openclawNativeRunner.js |
| `WORKSPACE_MKDIR_FAILED` | ${redactChunk(result.stderr || result.stdout)} | openclawNativeRunner.js |
| `EXECUTOR_FILE_WRITE_FAILED` | ${redactChunk(result.stderr || result.stdout)} | openclawNativeRunner.js |
| `OPENCLAW_TASK_TIMEOUT` | ${agentId || lawclawTaskId || currentTaskId || | openclawNativeRunner.js |
| `OPENCLAW_SESSION_NOT_FOUND` | ${taskId} | openclawNativeRunner.js |
| `OPENCLAW_SESSION_SEND_FAILED` | agent session send json: ${failureMessage} | openclawNativeRunner.js |
| `OPENCLAW_NATIVE_TIMEOUT` | OpenClaw 后台任务超时 | openclawNativeRunner.js |
| `OPENCLAW_MATERIALIZATION_FAILED` | ${redactChunk(materializeResult.stderr || materializeResult.stdout || | openclawNativeRunner.js |
| `OPENCLAW_NATIVE_FAILED` | ${summarizeOpenClawTerminalTaskFailure(terminalResult.task, terminalResult.taskI | openclawNativeRunner.js |
| `OPENCLAW_NATIVE_FAILED` | ${redactChunk(processResult.stderr || processResult.stdout || | openclawNativeRunner.js |

## 12. Key Constants & Timeouts

| Constant | Value | Human-Readable |
|---|---|---|
| RUN_TIMEOUT_SECONDS | 1800 | 2s |
| OUTPUT_STABLE_MS | 2500 | 3s |
| TASK_DISCOVERY_AFTER_PROCESS_CLOSE_MS | 30000 | 30s |
| FORMAL_PRODUCT_DISCOVERY_TIMEOUT_MS | 180000 | 3min |
| FORMAL_PRODUCT_COMPLETION_TIMEOUT_MS | 10 |  |
| OPENCLAW_TASK_STALL_TIMEOUT_MS | 15 |  |
| REVIEWER_TASK_TIMEOUT_MS | 20 |  |
| TROUBLESHOOTER_TASK_TIMEOUT_MS | 5 |  |
| GATEWAY_WARMUP_RETRY_DELAY_MS | 7000 | 7s |
| DEFAULT_GATEWAY_URL | http://127.0.0.1:18789 |  |
| WSL_DISTRO | Ubuntu |  |

## 14. Troubleshooting Checklist

1. **WSL Health**: Is Ubuntu installed? `wsl.exe -l -v`

2. **OpenClaw CLI**: `command -v openclaw` in WSL (not a `/mnt/` shim)

3. **Gateway Status**: `openclaw gateway status --json` + `openclaw gateway probe --json`

4. **Agent Config**: Does `~/.openclaw/agents/{id}/agent/agent.json` exist with valid model binding?

5. **Model Provider**: Is provider reachable? API key valid? Model ID exists in provider?

6. **Task State**: Read `.lawclaw/task.json` — status, currentStep, error

7. **Output Files**: Are delivery files present? Have draft signature?

8. **Progress Events**: Read `.lawclaw/process/case_progress.json`

9. **Reviews**: Check `.lawclaw/reviews/`

10. **Logs**: `%APPDATA%/claw-client/logs/` or `~/.openclaw/logs/`

