param(
  [switch]$SkipInstall,
  [switch]$SkipNodeModulesCopy,
  [switch]$SkipCleanDist,
  [switch]$SkipWebappBuild,
  [switch]$SkipApiBuild
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DistDir = Join-Path $RepoRoot "dist"

function Invoke-Yarn([string]$WorkingDirectory, [string[]]$Arguments) {
  $argLine = $Arguments -join " "
  Write-Host "yarn $argLine" -ForegroundColor Cyan
  $p = Start-Process -FilePath "yarn" -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw "Command failed (exit $($p.ExitCode)): yarn $argLine"
  }
}

if (-not $SkipInstall) {
  Invoke-Yarn -WorkingDirectory $RepoRoot -Arguments @()
}

if ($SkipInstall) {
  if (-not $SkipWebappBuild) {
    $WebappNg = Join-Path $RepoRoot "webapp\node_modules\.bin\ng.cmd"
    if (-not (Test-Path -LiteralPath $WebappNg)) {
      throw "SkipInstall was specified but webapp dependencies don't appear to be installed. Expected: $WebappNg. Run 'yarn install' (or 'yarn install:local') and retry."
    }
  }

  if (-not $SkipApiBuild) {
    $ApiTsc = Join-Path $RepoRoot "api\node_modules\.bin\tsc.cmd"
    if (-not (Test-Path -LiteralPath $ApiTsc)) {
      throw "SkipInstall was specified but api dependencies don't appear to be installed. Expected: $ApiTsc. Run 'yarn install' (or 'yarn install:local') and retry."
    }
  }
}

if (-not $SkipCleanDist) {
  if (Test-Path -LiteralPath $DistDir) {
    Remove-Item -LiteralPath $DistDir -Recurse -Force
  }
}

if (-not $SkipWebappBuild) {
  Invoke-Yarn -WorkingDirectory (Join-Path $RepoRoot "webapp") -Arguments @("build", "--prod")
}

if (-not $SkipApiBuild) {
  Invoke-Yarn -WorkingDirectory (Join-Path $RepoRoot "api") -Arguments @("build")
}

$DistPackageJson = Join-Path $DistDir "package.json"
$DistYarnLock = Join-Path $DistDir "yarn.lock"
$ApiPackageJson = Join-Path $RepoRoot "api\package.json"
$RootYarnLock = Join-Path $RepoRoot "yarn.lock"

if (-not (Test-Path -LiteralPath $DistDir)) {
  New-Item -ItemType Directory -Path $DistDir | Out-Null
}

if (Test-Path -LiteralPath $ApiPackageJson) {
  Copy-Item -LiteralPath $ApiPackageJson -Destination $DistPackageJson -Force
}

if (Test-Path -LiteralPath $RootYarnLock) {
  Copy-Item -LiteralPath $RootYarnLock -Destination $DistYarnLock -Force
}

$ApiNodeModules = Join-Path $RepoRoot "api\node_modules"
$DistNodeModules = Join-Path $DistDir "node_modules"

if (-not $SkipNodeModulesCopy) {
  if (-not (Test-Path -LiteralPath $ApiNodeModules)) {
    throw "Expected directory not found: $ApiNodeModules"
  }

  if (-not (Test-Path -LiteralPath $DistDir)) {
    New-Item -ItemType Directory -Path $DistDir | Out-Null
  }

  if (-not (Get-Command robocopy -ErrorAction SilentlyContinue)) {
    throw "robocopy not found on PATH"
  }

  $null = New-Item -ItemType Directory -Path $DistNodeModules -Force
  & robocopy $ApiNodeModules $DistNodeModules /MIR /XO /FFT /R:1 /W:1 /NP /NFL /NDL /NJH /NJS
  $rc = $LASTEXITCODE
  if ($rc -ge 8) {
    throw "robocopy failed with exit code $rc"
  }
}
