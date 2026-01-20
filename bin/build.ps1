# bin/build.ps1
# Execute script: powershell -NoProfile -ExecutionPolicy Bypass -File .\bin\build.ps1
param(
  [switch]$IncludeNodeModulesCopy,
  [switch]$IncludeFlags
)

$ErrorActionPreference = "Stop"

# Ensure we don't keep npm lockfiles in the repo between builds (we generate/copy them only into dist)
if (Test-Path "package-lock.json") {
  Write-Host "Removing stale package-lock.json..."
  Remove-Item -Force "package-lock.json"
}

# Install dependencies
powershell -NoProfile -ExecutionPolicy Bypass -File .\bin\install-deps.ps1

# Cleanup dist
if (Test-Path "dist") {
  Write-Host "Removing dist directory..."
  Remove-Item -Recurse -Force "dist"
}

# Build webapp
Write-Host "Building webapp..."
Push-Location "webapp"
if ($IncludeFlags.IsPresent) {
  yarn build:prod
} else {
  yarn build:prod:noflags
}
Pop-Location

# Build api
Write-Host "Building api..."
Push-Location "api"
yarn build:prod
Pop-Location

if ($IncludeNodeModulesCopy.IsPresent) {
  # Copy runtime deps (matches bash script behaviour)
  Write-Host "Copying api node_modules to dist..."
  New-Item -ItemType Directory -Force -Path "dist" | Out-Null
  Copy-Item -Recurse -Force "api\node_modules" "dist\"
} else {
  Write-Host "Skipping node_modules copy (default)."
}
