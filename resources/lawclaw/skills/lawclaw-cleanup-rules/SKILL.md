---
name: lawclaw-cleanup-rules
description: Cleanup and retention rules for LawClaw case artifacts, privacy intermediates, review reports, diagnostics, and recycle-bin handling. Use for cleanup questions, failures, and retention decisions.
---
# LawClaw Cleanup Rules

Do not directly delete files from an Agent response. Routine cleanup belongs to the desktop host; the Troubleshooter diagnoses failed cleanup and presents user-selectable options.

## Keep

- formal delivery outputs and final reports;
- task state required for history and recovery;
- reviewer and arbitration reports;
- diagnostic reports;
- user source materials;
- encrypted privacy mappings and recovery metadata placed in the approved private location.

## Recycle when safe

- runtime progress internals after successful completion;
- privacy working directories after private artifacts are preserved;
- fallback drafts, extracted text, and temporary material inventories;
- per-task Agent workspace mounts after all participating Agents finish.

## Never remove automatically

- credentials, provider/model configuration, Agent configuration, bundled skills, or workspace roots;
- anything outside the active case output directory;
- failed or cancelled task artifacts that may be needed for retry;
- any path that has not been resolved and checked by the host.

When advising the user, state the problem source, recommendation, files retained, and whether removed items go to the recycle bin.
