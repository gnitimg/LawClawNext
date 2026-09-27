---
name: lawclaw-material-extraction
description: Extract analysable text from local legal PDF, image, Markdown, and text materials with a lightweight native fallback. Use when preparing case evidence for analysis or checking whether OCR is needed.
---
# LawClaw Material Extraction

Use `scripts/pdf_extract.py` with the interpreter the desktop app provides: run it with `LAWCLAW_OCR_PYTHON` (an absolute path set in your environment). If that variable is missing, fall back to plain `python` for text-only extraction, and tell the user to run 程序自检 → 一键修复 to provision the local OCR environment.

**Never install or upgrade Python packages, never create environments, and never run speed benchmarks on the spot.** The desktop app provisions and verifies the OCR environment; if `rapidocr_onnxruntime` or `onnxruntime` cannot be imported, stop and report that 本地识别组件 needs repair instead of fixing it yourself.

Read `LAWCLAW_OCR_CONFIG` when present and honour its CPU/GPU choice.

## Workflow

1. Inventory only user-approved files.
2. Extract embedded PDF text before considering OCR.
3. Use OCR only for image-only pages and only when the app-provided interpreter can import `rapidocr_onnxruntime`.
4. When GPU is enabled, require an actual CUDA, DirectML, ROCm, or CoreML execution provider. Never silently fall back to CPU; report the missing provider so the user can make an informed choice.
5. Keep extracted text in the case working directory, not a global cache.
6. Record source paths, execution provider, and extraction status so downstream legal conclusions remain traceable.

## Cloud fallback

- Prefer local OCR. Only suggest cloud processing when local extraction fails or the user asks for it — do not benchmark first.
- Cloud upload requires explicit consent for that upload. A saved cloud configuration is not consent.
- Before upload, warn that names, identifiers, contact details, case facts, and evidence may be disclosed, retained, or transferred across borders, and link the configured provider terms and privacy policy.

## Output quality

- Treat empty or obviously garbled extraction as a failure, not as evidence that the source is empty.
- Mark image-only material that still needs OCR or manual review.
- Never infer missing legal facts from failed extraction.
