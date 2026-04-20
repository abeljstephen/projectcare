#!/bin/bash
# scripts/sync-gas.sh — Sync engines/shared/ → GAS deployment directories
#
# ProjectCare Master → ProjectCare GAS
# Run this before every `clasp push` to keep GAS in sync with the shared source.
#
# Usage (from repo root):
#   bash scripts/sync-gas.sh
#
# The GAS directories (api/core/saco-gas/ and api/core/cpm-gas/) are
# AUTO-GENERATED from engines/shared/. Never edit them directly.
# All engine changes must be made in engines/shared/ first.

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHARED_SACO="$REPO_ROOT/engines/shared/saco"
SHARED_CPM="$REPO_ROOT/engines/shared/cpm"
GAS_SACO="$REPO_ROOT/api/core/saco-gas"
GAS_CPM="$REPO_ROOT/api/core/cpm-gas"

echo "=== ProjectCare: syncing engines/shared/ → GAS ==="

# ── SACO engine ───────────────────────────────────────────────────────────────
echo "[1/2] Syncing SACO engine (shared/saco → api/core/saco-gas)..."

# Remove old .gs engine files (they are replaced by .js files from shared/)
# GAS-specific files (sheet-writer.gs, main-specific) are NOT in shared/ so are untouched.
find "$GAS_SACO" -name "*.gs" \
  ! -name "sheet-writer.gs" \
  -delete

# Copy shared SACO files into GAS directory (preserve subdirectory structure)
rsync -a --include="*.js" --include="*/" --exclude="*" \
  "$SHARED_SACO/" "$GAS_SACO/"

echo "    SACO: $(find "$GAS_SACO" -name "*.js" | wc -l | tr -d ' ') .js files synced"

# ── CPM engine ────────────────────────────────────────────────────────────────
echo "[2/2] Syncing CPM engine (shared/cpm → api/core/cpm-gas)..."

# Remove old .gs CPM engine files
find "$GAS_CPM" -name "*.gs" -delete

# Copy shared CPM files (exclude the tests/ subdirectory)
# Note: --exclude must come before --include wildcards in rsync
rsync -a --exclude="tests/" --include="*.js" --include="*/" --exclude="*" \
  "$SHARED_CPM/" "$GAS_CPM/"

echo "    CPM:  $(find "$GAS_CPM" -name "*.js" | wc -l | tr -d ' ') .js files synced"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Sync complete. Ready for: cd api && clasp push ==="
echo ""
echo "GAS files:"
find "$GAS_SACO" "$GAS_CPM" -name "*.js" -o -name "*.gs" | sort | sed "s|$REPO_ROOT/||"
