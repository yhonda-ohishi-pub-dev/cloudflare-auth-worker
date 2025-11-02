#!/bin/bash
# Upload secrets from .dev.vars to Cloudflare Workers
#
# Usage:
#   ./upload-secrets.sh
#   ./upload-secrets.sh --dry-run  # Preview without uploading

set -e

DEV_VARS_FILE=".dev.vars"
DRY_RUN=false

# Parse arguments
if [[ "$1" == "--dry-run" ]]; then
  DRY_RUN=true
fi

echo "============================================================"
echo "Cloudflare Workers Secret Upload"
echo "============================================================"
echo ""

# Check if .dev.vars exists
if [[ ! -f "$DEV_VARS_FILE" ]]; then
  echo "Error: $DEV_VARS_FILE not found"
  exit 1
fi

echo "Reading secrets from: $DEV_VARS_FILE"
echo ""

# Read and upload secrets
success_count=0
fail_count=0
total_count=0

while IFS='=' read -r key value; do
  # Skip empty lines and comments
  [[ -z "$key" || "$key" =~ ^# ]] && continue

  # Trim whitespace
  key=$(echo "$key" | xargs)
  value=$(echo "$value" | xargs)

  [[ -z "$key" ]] && continue

  total_count=$((total_count + 1))

  # Preview value (first 30 chars)
  preview="${value:0:30}"
  [[ ${#value} -gt 30 ]] && preview="${preview}..."

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY RUN] Would upload: $key=$preview"
    success_count=$((success_count + 1))
  else
    echo "Uploading secret: $key..."
    if echo "$value" | npx wrangler secret put "$key" > /dev/null 2>&1; then
      echo "✓ Successfully uploaded: $key"
      success_count=$((success_count + 1))
    else
      echo "✗ Failed to upload: $key"
      fail_count=$((fail_count + 1))
    fi
  fi
  echo ""

done < "$DEV_VARS_FILE"

# Summary
echo "============================================================"
echo "Upload Summary"
echo "============================================================"
echo "Total secrets: $total_count"
echo "✓ Successful: $success_count"
[[ $fail_count -gt 0 ]] && echo "✗ Failed: $fail_count"
echo ""

if [[ "$DRY_RUN" == true ]]; then
  echo "Run without --dry-run to actually upload secrets."
else
  echo "All secrets have been uploaded to Cloudflare Workers!"
fi
