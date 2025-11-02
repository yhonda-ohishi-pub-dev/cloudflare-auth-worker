# Upload secrets from .dev.vars to Cloudflare Workers
#
# Usage:
#   .\upload-secrets.ps1
#   .\upload-secrets.ps1 -DryRun  # Preview without uploading

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$DEV_VARS_FILE = ".dev.vars"

Write-Host "============================================================"
Write-Host "Cloudflare Workers Secret Upload"
Write-Host "============================================================"
Write-Host ""

# Check if .dev.vars exists
if (-not (Test-Path $DEV_VARS_FILE)) {
    Write-Host "Error: $DEV_VARS_FILE not found" -ForegroundColor Red
    exit 1
}

Write-Host "Reading secrets from: $DEV_VARS_FILE"
Write-Host ""

# Read and upload secrets
$successCount = 0
$failCount = 0
$totalCount = 0

Get-Content $DEV_VARS_FILE | ForEach-Object {
    $line = $_.Trim()

    # Skip empty lines and comments
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
        return
    }

    # Parse KEY=VALUE
    if ($line -match '^([^=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()

        if ([string]::IsNullOrWhiteSpace($key)) {
            return
        }

        $totalCount++

        # Preview value (first 30 chars)
        $preview = if ($value.Length -gt 30) {
            $value.Substring(0, 30) + "..."
        } else {
            $value
        }

        if ($DryRun) {
            Write-Host "[DRY RUN] Would upload: $key=$preview"
            $script:successCount++
        } else {
            Write-Host "Uploading secret: $key..."

            # Write value to temp file to avoid escaping issues
            $tempFile = Join-Path $env:TEMP "wrangler-secret-temp.txt"
            Set-Content -Path $tempFile -Value $value -NoNewline

            try {
                # Use Get-Content to read file and pipe to wrangler
                Get-Content $tempFile -Raw | npx wrangler secret put $key 2>&1 | Out-Null

                if ($LASTEXITCODE -eq 0) {
                    Write-Host "✓ Successfully uploaded: $key" -ForegroundColor Green
                    $script:successCount++
                } else {
                    Write-Host "✗ Failed to upload: $key" -ForegroundColor Red
                    $script:failCount++
                }
            } catch {
                Write-Host "✗ Failed to upload: $key - $_" -ForegroundColor Red
                $script:failCount++
            } finally {
                # Clean up temp file
                if (Test-Path $tempFile) {
                    Remove-Item $tempFile -Force
                }
            }
        }
        Write-Host ""
    }
}

# Summary
Write-Host "============================================================"
Write-Host "Upload Summary"
Write-Host "============================================================"
Write-Host "Total secrets: $totalCount"
Write-Host "✓ Successful: $successCount" -ForegroundColor Green
if ($failCount -gt 0) {
    Write-Host "✗ Failed: $failCount" -ForegroundColor Red
}
Write-Host ""

if ($DryRun) {
    Write-Host "Run without -DryRun to actually upload secrets."
} else {
    Write-Host "All secrets have been uploaded to Cloudflare Workers!"
}
