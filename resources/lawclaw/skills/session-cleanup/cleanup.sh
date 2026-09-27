#!/usr/bin/env bash
# session-cleanup: 会话垃圾清理脚本
# 用法: bash cleanup.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

OPENCLAW_DIR="${HOME}/.openclaw"
RECYCLE="${OPENCLAW_DIR}/回收站"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

count_bak=0
count_clobbered=0
count_zone=0
size_lawyer=0
size_workspace=0

log() { echo -e "${GREEN}✅${NC} $*"; }
warn() { echo -e "${YELLOW}⚠️${NC} $*"; }
dry() { echo -e "${RED}[DRY-RUN]${NC} $*"; }

# Step 1: 扫描
echo "🔍 扫描垃圾文件..."
echo ""

# 配置备份
bak_count=$(find "$OPENCLAW_DIR" -maxdepth 1 -name 'openclaw.json.bak*' -type f 2>/dev/null | wc -l)
clobbered_count=$(find "$OPENCLAW_DIR" -maxdepth 1 -name 'openclaw.json.clobbered.*' -type f 2>/dev/null | wc -l)
old_config=$(find "$OPENCLAW_DIR" -maxdepth 1 -name 'openclaw1.json' -type f 2>/dev/null | wc -l)
echo "  配置备份: ${bak_count} 个 .bak, ${clobbered_count} 个 .clobbered, ${old_config} 个旧配置"

# Zone.Identifier (排除回收站目录)
zone_count=$(find "$OPENCLAW_DIR" -name '*Zone.Identifier*' -type f -not -path "*/回收站/*" 2>/dev/null | wc -l)
echo "  Zone.Identifier: ${zone_count} 个"

# workspace 处理产物
lawclaw_size=$(du -sh "$OPENCLAW_DIR/workspace/LAWCLAW_CASE_MATERIALS" "$OPENCLAW_DIR/workspace/LAWCLAW_SKILLS" 2>/dev/null | tail -1 | cut -f1 || echo "0")
echo "  workspace LAWCLAW 产物: ${lawclaw_size}"

# workspace-lawyer
if [ -d "$OPENCLAW_DIR/workspace-lawyer" ]; then
  wl_size=$(du -sh "$OPENCLAW_DIR/workspace-lawyer" 2>/dev/null | cut -f1)
  echo "  workspace-lawyer: ${wl_size}"
else
  wl_size="0"
  echo "  workspace-lawyer: 不存在"
fi

# Lawyer/Output
if [ -d "$OPENCLAW_DIR/Lawyer/Output" ]; then
  lo_size=$(du -sh "$OPENCLAW_DIR/Lawyer/Output" 2>/dev/null | cut -f1)
  echo "  Lawyer/Output: ${lo_size}"
else
  lo_size="0"
  echo "  Lawyer/Output: 不存在"
fi

echo ""

if $DRY_RUN; then
  echo "🔍 [DRY-RUN] 以上为待清理项，未执行任何操作。"
  exit 0
fi

# Step 2: 创建回收站
mkdir -p "$RECYCLE/config-backups"
mkdir -p "$RECYCLE/zone-identifiers"

# Step 3: 移动配置备份
echo "📦 移动配置备份..."
LATEST=$(ls -t "$OPENCLAW_DIR"/openclaw.json.bak* 2>/dev/null | head -1 || true)
for f in "$OPENCLAW_DIR"/openclaw.json.bak*; do
  [ -f "$f" ] || continue
  [ "$f" = "$LATEST" ] && { log "保留最新: $(basename "$f")"; continue; }
  mv "$f" "$RECYCLE/config-backups/" && count_bak=$((count_bak+1))
done
for f in "$OPENCLAW_DIR"/openclaw.json.clobbered.*; do
  [ -f "$f" ] || continue
  mv "$f" "$RECYCLE/config-backups/" && count_clobbered=$((count_clobbered+1))
done
[ -f "$OPENCLAW_DIR/openclaw1.json" ] && mv "$OPENCLAW_DIR/openclaw1.json" "$RECYCLE/config-backups/" && log "移走 openclaw1.json"

# Step 4: 移动 Zone.Identifier
echo "🗑️ 移动 Zone.Identifier..."
find "$OPENCLAW_DIR" -name '*Zone.Identifier*' -type f -not -path "*/回收站/*" 2>/dev/null | while read f; do
  rel="${f#$OPENCLAW_DIR/}"
  mkdir -p "$RECYCLE/zone-identifiers/$(dirname "$rel")"
  mv "$f" "$RECYCLE/zone-identifiers/$rel" && count_zone=$((count_zone+1))
done

# Step 5: 移动 workspace 处理产物
echo "📁 移动 workspace 处理产物..."
mkdir -p "$RECYCLE/workspace-lawclaw"
for d in LAWCLAW_CASE_MATERIALS LAWCLAW_SKILLS; do
  [ -d "$OPENCLAW_DIR/workspace/$d" ] && mv "$OPENCLAW_DIR/workspace/$d" "$RECYCLE/workspace-lawclaw/" && log "移走 $d"
done
[ -f "$OPENCLAW_DIR/workspace/LAWCLAW_WORKSPACE_RESOURCES.json" ] && mv "$OPENCLAW_DIR/workspace/LAWCLAW_WORKSPACE_RESOURCES.json" "$RECYCLE/workspace-lawclaw/" && log "移走 LAWCLAW_WORKSPACE_RESOURCES.json"
[ -f "$OPENCLAW_DIR/workspace/LAWCLAW_TASK.md" ] && mv "$OPENCLAW_DIR/workspace/LAWCLAW_TASK.md" "$RECYCLE/workspace-lawclaw/" && log "移走 LAWCLAW_TASK.md"
[ -d "$OPENCLAW_DIR/workspace/rag" ] && mv "$OPENCLAW_DIR/workspace/rag" "$RECYCLE/workspace-lawclaw/" && log "移走 rag/"

# Step 6: 移动 workspace-lawyer
if [ -d "$OPENCLAW_DIR/workspace-lawyer" ]; then
  echo "📁 移动 workspace-lawyer..."
  mv "$OPENCLAW_DIR/workspace-lawyer" "$RECYCLE/" && log "移走 workspace-lawyer/"
fi

# Step 7: 移动 Lawyer/Output
if [ -d "$OPENCLAW_DIR/Lawyer/Output" ]; then
  echo "📁 移动 Lawyer/Output..."
  mv "$OPENCLAW_DIR/Lawyer" "$RECYCLE/" && log "移走 Lawyer/"
fi

# Step 8: 汇报
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧹 清理完成！"
echo ""
echo "已移入回收站 (${RECYCLE}/):"
echo "  - 配置备份: ${count_bak} 个 .bak, ${count_clobbered} 个 .clobbered"
echo "  - Zone.Identifier: ${count_zone} 个"
echo "  - workspace 处理产物"
[ -d "$RECYCLE/workspace-lawyer" ] && echo "  - workspace-lawyer"
[ -d "$RECYCLE/Lawyer" ] && echo "  - Lawyer/Output"
echo ""
echo "回收站大小: $(du -sh "$RECYCLE" 2>/dev/null | cut -f1)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
