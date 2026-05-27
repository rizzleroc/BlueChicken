#!/usr/bin/env bash
# rename-tripo-models.sh
# -----------------------------------------------------------------------------
# Rename the 5 Tripo-generated GLB files into the names the realm loader
# expects (docs/models/<id>.glb), then move them into place.
#
# Usage:
#   1. Save your 5 GLBs into one directory — call it $SRC below. They should
#      still have their Tripo job filenames (job_aqy1ipay.glb, etc.).
#   2. Run this from the BlueChicken repo root:
#        bash tools/rename-tripo-models.sh /path/to/the/glbs
#      (or set SRC inline)
#
# It's idempotent — re-running with the same SRC just overwrites the
# destination files.

set -euo pipefail

SRC="${1:-}"
if [ -z "$SRC" ]; then
  echo "usage: $0 <source-dir-containing-tripo-glbs>" >&2
  exit 2
fi
if [ ! -d "$SRC" ]; then
  echo "error: source dir not found: $SRC" >&2
  exit 2
fi

DEST="docs/models"
mkdir -p "$DEST"

# Tripo job_id  -->  hatchling id
declare -A MAP=(
  ["job_aqy1ipay"]="glimmer"
  ["job_g6fp70k4"]="whisper"
  ["job_vnuy9cyg"]="pip"
  ["job_xhuk8dqn"]="bubble"
  ["job_3z8qtx7x"]="ember"
)

moved=0
missing=()
for job in "${!MAP[@]}"; do
  hatchling="${MAP[$job]}"
  src_file="$SRC/${job}.glb"
  dst_file="$DEST/${hatchling}.glb"
  if [ -f "$src_file" ]; then
    cp -f "$src_file" "$dst_file"
    size=$(stat -c '%s' "$dst_file" 2>/dev/null || stat -f '%z' "$dst_file")
    echo "  ${job}.glb  ->  ${dst_file}  (${size} bytes)"
    moved=$((moved + 1))
  else
    missing+=("$src_file")
  fi
done

echo
echo "moved $moved file(s) into $DEST/"
if [ "${#missing[@]}" -gt 0 ]; then
  echo "missing from $SRC (skipped):"
  for m in "${missing[@]}"; do echo "  $m"; done
fi
