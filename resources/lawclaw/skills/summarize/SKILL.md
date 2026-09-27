---
name: 材料摘要
description: Summarize long legal case materials without losing source boundaries, uncertainty, dates, amounts, parties, or evidence references. Use when a case file or review report must be condensed for downstream analysis.
version: 1.0.0
---

# 材料摘要

按来源分别摘要案件材料。保留主体、时间、金额、请求、证据名称和页码或文件定位；区分原文事实、当事人主张、模型推断和待核实事项。

不得把多个来源中的相似陈述合并成已经证实的事实，不得补写原文没有的法条、案例或结论。遇到 OCR 缺失、页面稀疏、扫描质量差或上下文截断时，明确标注缺口及其对后续分析的影响。

摘要供后续 Agent 使用时，优先输出：

- 来源文件与定位
- 关键事实和时间线
- 当事人主张
- 证据及证明目的
- 矛盾、缺口与待核实事项
- 不可据此得出的结论
