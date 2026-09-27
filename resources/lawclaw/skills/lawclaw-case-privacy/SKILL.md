---
name: lawclaw-case-privacy
description: Locally redact sensitive Chinese legal case materials and restore authorised working copies using LawClaw's encrypted token mapping. Use before sending case materials to any model, or when an authorised user requests restoration.
---
# LawClaw Case Privacy

Keep source materials and recovery keys on the user's device. Never include a recovery key, raw mapping, identity number, bank number, phone number, email address, or unredacted party name in a model prompt or log.

## Redaction

1. Work on a user-approved input directory and a separate output directory.
2. Run `scripts/redact_case.py` with native Python. Do not use WSL.
3. Prefer CPU execution. OCR acceleration is optional and must not be required for startup.
4. Verify the command's JSON result, the redacted output, and encrypted mapping metadata.
5. Present the recovery key once and ask the user to store it separately.

## Restoration

Use `scripts/restore_case.py` only after explicit user authorisation. Require the encrypted mapping, metadata, and recovery key. Restore into a new directory; never overwrite the redacted source tree.

## Safety

- Do not upload private artifacts or recovery material.
- Do not claim that passthrough binary files were redacted unless the result explicitly confirms it.
- If a dependency is missing, report the native Python package required and stop safely.
