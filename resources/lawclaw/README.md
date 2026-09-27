# LawClaw bundled resources

This directory contains the capabilities migrated from the original LawClaw client.

- `skills/` contains Agent Skills that can be enabled from the desktop skill market.
- `scripts/privacy/` contains the original local material extraction, redaction, and restoration tools.
- `scripts/legacy/` contains the original OpenClaw knowledge generation/synchronisation helpers for migration reference. They are not executed by LawClaw Next.
- `knowledge/` preserves the generated troubleshooting knowledge base from the previous runtime.

LawClaw Next does not require WSL. Runtime integrations must invoke native tools and treat these bundled resources as read-only application assets.
