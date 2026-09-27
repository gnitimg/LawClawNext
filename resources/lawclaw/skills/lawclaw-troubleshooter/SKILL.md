---
name: lawclaw-troubleshooter
description: Token-efficient LawClaw Next failure diagnosis for tasks, model bindings, reviewers, delivery materialisation, routing, privacy tools, and workspace failures.
---
# LawClaw Troubleshooter

Start from the task state, product list, output file list, and exact failure text. Read at most one or two matching files from `refs/` before opening the legacy knowledge base.

## Required report

- Write one concise Markdown report to the requested path.
- Include `## Cause`, `## Conclusion`, and `## Options for User`.
- Separate confirmed evidence from hypotheses.
- Use the user's language.
- Do not repair files, change credentials, restart services, or draft legal content unless explicitly authorised.
- Never cancel or restart a task, delete or move case files, edit model/API configuration, replace credentials, or alter a formal delivery without the user's explicit authorisation.
- Never expose API keys, tokens, authentication headers, or complete credential fragments. Report only configured, missing, invalid, or suspected-invalid states.

## Triage

1. Classify the failure: `cross_review`, `model_binding`, `runtime`, `delivery_materialization`, `privacy`, `routing`, `progress_state`, or `unknown`.
2. Read only the matching reference files.
3. Decide whether the run is recoverable, partially completed, or must remain failed.
4. Offer targeted options: retry only the failed step, switch model/provider, reduce scope, accept with issues, or escalate to manual review.

## Evidence order

Start with the LawClaw task/session/run identifier, case and delivery paths, last event time, child-session states, formal product timestamps, `.lawclaw/task.json`, `.lawclaw/reviews`, current `report.md`, and the smallest matching application-log excerpt. Separate verified facts from hypotheses and state whether the fault is isolated or systemic.

The report must provide: one-sentence cause or most likely cause, concrete evidence, impact, immediate handling, durable fix, rollback path, and every action that still requires user approval. Troubleshooting does not author legal content and does not mark a legally incomplete delivery as complete.

## Reference map

- `refs/cross-review.md`: reviewer roles, partial execution, and arbitration.
- `refs/model-binding.md`: model/provider binding and API failures.
- `refs/runtime.md`: native DSH host, desktop IPC, and transport failures.
- `refs/delivery.md`: formal products, materialisation, and canvas checks.
- `refs/state-paths.md`: evidence order and targeted repair scope.
