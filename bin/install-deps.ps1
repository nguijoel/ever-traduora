$ErrorActionPreference = "Stop"

Write-Host "Installing root dependencies..."
yarn install

Write-Host "Installing webapp dependencies..."
Push-Location "webapp"
yarn install
Pop-Location

Write-Host "Installing api dependencies..."
Push-Location "api"
yarn install
Pop-Location
