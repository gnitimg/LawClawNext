---
name: 正式交付与署名协议
description: Enforce LawClaw's formal legal deliverables, Obsidian Canvas validity, model provenance signatures, independent dual review, and Main arbitration. Use for every case-analysis workflow that creates or reviews delivery files.
version: 1.0.0
---

# LawClaw 正式交付与署名协议

本协议是案件交付的强制约束，不是写作建议。它适用于 Main、主办律师、对方律师审查和法官审查 Agent。不得用普通聊天回复代替文件交付，不得由宿主程序事后伪造模型署名。

## 正式产物

除非用户明确缩小交付范围，完整案件分析必须生成以下五类正式文件：

- `案件分析报告.md`
- `辩护意见书.md`
- `对方策略预判.md`
- `质证意见.md`
- `知识图谱.canvas`

Markdown 文书必须包含完整法律内容，不得是提纲、占位文本、调试草稿或“稍后生成”的承诺。使用标准 Markdown 标题、列表、表格和必要的加粗；只禁止无意义的装饰线。

不得在正式产物中写入系统提示词、内部调用说明、工具调试信息、任务占位状态或虚构的调用记录。

## 事实与证据边界

- 必须逐份阅读材料正文，不得仅根据文件名猜测。
- 明确区分已证实事实、当事人陈述、推断和待核实事项。
- 法条、案例、时间、金额、主体和证据来源不得臆造。
- 无法从材料确认时必须标注缺口、影响和补证方向。

## 起草署名

起草 Agent 必须在完成每一份正式产物时亲自写入来源署名，LawClaw 宿主不得在生成后代签。

模型署名由“实际 Agent 显示名 + 当前绑定的 provider/model”组成：

`<Agent 显示名>（<provider> / <model>）`

每一份 Markdown 正式文书必须在正文末尾保留：

```text
---
起草：<实际起草 Agent 显示名>（<provider> / <model>）
```

由 Lawyer Agent 起草时必须署 Lawyer Agent，不得署 Main；由 Main 直接起草时署 Main。不得冒用其他 Agent 或其他模型的身份。

## Canvas

`知识图谱.canvas` 必须是合法的 Obsidian Canvas JSON：

- 根对象必须包含 `nodes` 和 `edges` 数组。
- 不得使用 Markdown 代码围栏包裹 JSON。
- JSON 文档后不得追加说明文字。
- 节点应表达案件主体、事实、证据、争点、法律依据及其关系；不得只生成装饰图形。
- 必须加入一个普通文本节点，内容包含 `模型署名` 和与 Markdown 文书一致的 `起草：...` 行。
- 需要图谱说明时可另建 `知识图谱说明.md`，但不能代替 `.canvas` 文件。

使用 `json-canvas` skill 的格式要求创建和校验 Canvas。

## 双重独立审查

Main 必须先冻结同一份起草版本并记录文件清单与 SHA-256，再把该冻结版本分别交给：

- Reviewer Opponents（对方律师视角）
- Reviewer Judge（法官视角）

两名审查 Agent 必须独立工作，不得在各自提交前读取、推测或复述另一名审查者的结论。详细理由写入各自的 Markdown 审查报告；正式文书中只写紧凑核验戳。

审查报告至少覆盖逐文书通过/不通过、事实缺口、证据链风险、法律适用或对抗风险、必要修正和总体结论，并由审查模型亲自落款：

```text
---
评审【opponents】：<Reviewer Opponents 显示名>（<provider> / <model>）
```

或：

```text
---
评审【judge】：<Reviewer Judge 显示名>（<provider> / <model>）
```

每份 Markdown 正式文书只追加对应审查者的一行状态戳：

```text
评审【opponents】：通过|不通过 <Reviewer Opponents 显示名>（<provider> / <model>）
评审【judge】：通过|不通过 <Reviewer Judge 显示名>（<provider> / <model>）
```

Canvas 必须继续保持合法 JSON；能安全修改时把紧凑核验戳写入普通文本节点，不能安全修改时保持 Canvas 不变并在审查报告中完整覆盖。

## Main 仲裁

Main 必须等待两名审查者都进入终态后再仲裁，不得把模型厂商或模型名当作审查者名称。用户可见名称只使用角色名称，provider/model 仅出现在完整署名中。

统一的 `report.md` 是详细审查理由和 Main 仲裁的权威文件。它必须逐文件列出两名审查者的结论与理由、Main 的最终结论，并以以下落款结束：

```text
---
署名：<Main Agent 显示名>（<provider> / <model>）
```

一名审查者技术失败时，最多标记 `completed_with_issues`，并明确缺失的审查证据；两名审查者都失败时不得正式交付。缺少详细理由或署名的部分输出不得冒充完成的审查结论，应要求重试或人工复核。

## 完成门槛

只有同时满足下列条件，Main 才能把案件标记为正式交付：

- 约定的正式文件均实际存在且内容完整。
- Canvas 可解析且包含 `nodes`、`edges` 和起草署名节点。
- 起草署名与实际写作者及其模型绑定一致。
- 两名审查者针对同一冻结版本完成独立审查，或按失败规则明确降级。
- `report.md` 包含可追溯的审查理由、最终仲裁和 Main 署名。
- 所有被分派的子 Agent 已进入终态，Main 不得在子任务仍运行时提前回复“完成”。

## 重试、修复与报告留存

- 重试前必须读取当前 `delivery/report.md`、用户本轮反馈和 `.lawclaw/reviews/*.md`，不得把重试当作全新案件从头猜测。
- 重试仍必须执行法条核验、双重独立审查、Main 仲裁和交付校验；不得因为“只是修一处”跳过审查。
- 自动修正最多一轮（v1 → v2）。v2 仍有致命问题、重大金额疑问或法条争议时，停止自动循环并明确请求律师人工复核。
- 不得修改用户已经确认的事实、诉讼请求或策略；如确需改变，必须先说明影响并取得明确授权。
- 修复只能触及已授权的文件清单。修复前记录回滚检查点，修复后重跑失败步骤；验证失败必须回滚或保持失败状态。
- `report.md` 是审查证据与 Main 仲裁记录，不是要求用户逐字批准的正式文书。面向用户确认的是五类正式产物及其风险说明。
- `delivery/report.md` 只保留最新有效仲裁报告。开始新一轮前，将旧报告连同轮次、时间和草稿哈希追加到 `.lawclaw/reviews/report-archive.md`，不得静默覆盖审查历史。

## 法律工作纪律

- 法律结论必须以案件材料和现行有效法律为依据；引用至少精确到条，禁止只写“依据相关规定”。
- 证据必须分别审查真实性、合法性和关联性，并说明证据链缺口、证明责任和补证方向。
- 涉及金额、利息、份额或期限时，必须列出公式、参数来源、计算过程和假设条件；不得凭感觉估算。
- 使用“可能”“倾向于”“建议核实”等审慎表达，不作无依据的胜诉保证，也不声称替代执业律师。
- 正式文书含法条引用时，必须先执行 `legal-article-verify`，再进入双重审查。
