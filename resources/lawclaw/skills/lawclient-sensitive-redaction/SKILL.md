---
name: lawclient-sensitive-redaction
description: Local sensitive information redaction for LawClient before cloud upload. Detects China ID cards, bank cards, and address spans, replaces them with typed tokens, and protects the recovery mapping with SM4-GCM.
---

# LawClient Sensitive Redaction

Use this skill when LawClient needs to preprocess legal case files locally before sending content to cloud agents.

The workflow must remain local-first:

1. Read case text files from a local input directory.
2. Detect China mainland ID cards, bank cards, and address spans.
3. Replace sensitive spans with typed tokens such as `<ID_CARD_8f3a9c2e>`, `<BANK_CARD_f13b02aa>`, and `<ADDRESS_9ab71d0e>`.
4. Write redacted files to a controlled output workspace.
5. Store token-to-raw mapping only as encrypted SM4-GCM data.
6. Restore final cloud results locally by decrypting the mapping and replacing tokens with original values.

Do not use a model for detection. Do not upload raw mapping data. Do not write plaintext mapping files in production.

Use these scripts:

```bash
python scripts/privacy/redact_case.py --input-dir ./case_input --output-dir ./case_output
python scripts/privacy/restore_case.py --input-dir ./cloud_result --output-dir ./restored_output --mapping ./case_output/private/mapping.enc --meta ./case_output/private/mapping.meta.json --recovery-key-file ./case_output/private/recovery.key
python scripts/privacy/decrypt_mapping_backup.py --mapping ./case_output/private/mapping.enc --meta ./case_output/private/mapping.meta.json --recovery-key-file ./case_output/private/recovery.key --output ./mapping.recovered.json
```

For integration, LawClient should call `redact_case.py` before cloud upload and `restore_case.py` after cloud output is received.

Security rules:

- The cloud sees only typed tokens.
- The mapping file must be encrypted with SM4-GCM.
- Time values can be used as case identifiers and metadata, not as encryption keys.
- Do not use ECB.
- Do not log raw sensitive values.
- Keep all intermediate files under the selected output directory.
- Delete the private workspace when the case is fully delivered if the user chooses high-security cleanup.
