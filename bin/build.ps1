$ErrorActionPreference = "Stop"
# Execute script: powershell -NoProfile -ExecutionPolicy Bypass -File .\bin\build.ps1
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
yarn build:prod
Pop-Location

# Build api
Write-Host "Building api..."
Push-Location "api"
yarn build:prod
Pop-Location

# Copy runtime deps (matches bash script behaviour)
Write-Host "Copying api node_modules to dist..."
New-Item -ItemType Directory -Force -Path "dist" | Out-Null
Copy-Item -Recurse -Force "api\node_modules" "dist\"
