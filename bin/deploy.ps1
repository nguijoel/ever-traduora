param(
  [string]$LocalDir = (Join-Path $PSScriptRoot "..\dist"),
  [string]$RemoteDir = "resx.ontoo.cloud",
  [switch]$UseTls
)

$HostName = $env:DEPLOY_HOST
$UserName = $env:DEPLOY_USER
$Password = $env:DEPLOY_PASSWORD

if (-not $UseTls.IsPresent -and -not [string]::IsNullOrWhiteSpace($env:DEPLOY_USE_TLS)) {
  $UseTls = ($env:DEPLOY_USE_TLS -eq "1" -or $env:DEPLOY_USE_TLS -eq "true")
}

$IgnoreTlsCertErrors = ($env:DEPLOY_TLS_IGNORE_CERT_ERRORS -eq "1" -or $env:DEPLOY_TLS_IGNORE_CERT_ERRORS -eq "true")

if ($UseTls -and $IgnoreTlsCertErrors) {
  [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
}

if ([string]::IsNullOrWhiteSpace($HostName) -or [string]::IsNullOrWhiteSpace($UserName) -or [string]::IsNullOrWhiteSpace($Password)) {
  throw "Missing required environment variables: DEPLOY_HOST, DEPLOY_USER, DEPLOY_PASSWORD"
}

if (-not (Test-Path -LiteralPath $LocalDir)) {
  throw "Local directory not found: $LocalDir"
}

function New-FtpUri([string]$path) {
  $p = $path -replace "\\", "/"
  $p = $p.TrimStart('/')
  return "ftp://$HostName/$p"
}

function New-FtpRequest([string]$uri, [string]$method) {
  $req = [System.Net.FtpWebRequest]::Create($uri)
  $req.Method = $method
  $req.Credentials = New-Object System.Net.NetworkCredential($UserName, $Password)
  $req.UseBinary = $true
  $req.UsePassive = $true
  $req.KeepAlive = $false
  $req.EnableSsl = [bool]$UseTls
  return $req
}

function Ensure-RemoteDirectory([string]$remotePath) {
  $segments = $remotePath -replace "\\", "/" -split "/" | Where-Object { $_ -ne "" }
  $current = ""

  foreach ($seg in $segments) {
    $current = if ($current) { "$current/$seg" } else { $seg }
    $uri = New-FtpUri $current

    try {
      $req = New-FtpRequest $uri ([System.Net.WebRequestMethods+Ftp]::MakeDirectory)
      $resp = $req.GetResponse()
      $resp.Close()
    } catch {
      $msg = $_.Exception.Message
      if ($msg -notmatch "550") {
        throw
      }
    }
  }
}

function Upload-File([string]$localFile, [string]$remoteFilePath) {
  Ensure-RemoteDirectory ([System.IO.Path]::GetDirectoryName($remoteFilePath))

  $uri = New-FtpUri $remoteFilePath
  $req = New-FtpRequest $uri ([System.Net.WebRequestMethods+Ftp]::UploadFile)

  $bytes = [System.IO.File]::ReadAllBytes($localFile)
  $req.ContentLength = $bytes.Length

  $stream = $req.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()

  $resp = $req.GetResponse()
  $resp.Close()
}

$LocalDir = (Resolve-Path -LiteralPath $LocalDir).Path
$RemoteDir = ($RemoteDir -replace "\\", "/").Trim("/")

Ensure-RemoteDirectory $RemoteDir

$baseLen = $LocalDir.Length
if (-not $LocalDir.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
  $baseLen = $baseLen + 1
}

Get-ChildItem -LiteralPath $LocalDir -Recurse -File | ForEach-Object {
  $rel = $_.FullName.Substring($baseLen) -replace "\\", "/"
  if ($rel -match "^test/") {
    return
  }
  if ($rel -match "\.d\.ts$" -or $rel -match "\.map$") {
    return
  }
  $remotePath = if ($RemoteDir) { "$RemoteDir/$rel" } else { $rel }
  Write-Host "Uploading $rel"
  Upload-File $_.FullName $remotePath
}

Write-Host "Done. Uploaded '$LocalDir' to ftp://$HostName/$RemoteDir"
