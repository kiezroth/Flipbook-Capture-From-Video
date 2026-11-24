<#
.SYNOPSIS
  Copies ffmpeg.exe and ffprobe.exe into vendor/ffmpeg so the installer can bundle them.
.PARAMETER From
  Folder holding the binaries. Default: the folder of `ffmpeg` found on PATH. Nothing is downloaded.
#>
param([string]$From)

$ErrorActionPreference = 'Stop'

if (-not $From) {
  $cmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if (-not $cmd) { throw 'ffmpeg not found on PATH; pass -From <dir>.' }
  $From = Split-Path -Parent $cmd.Source
}

$ffmpeg = Join-Path $From 'ffmpeg.exe'
$ffprobe = Join-Path $From 'ffprobe.exe'
foreach ($f in @($ffmpeg, $ffprobe)) {
  if (-not (Test-Path -LiteralPath $f)) { throw "Missing $f" }
}

$encoders = & $ffmpeg -hide_banner -encoders 2>&1 | Out-String
if ($encoders -notmatch 'libx264') { throw "This ffmpeg build has no libx264 encoder ($ffmpeg). Use a full/GPL build (e.g. gyan.dev)." }

$dest = Join-Path (Split-Path -Parent $PSScriptRoot) 'vendor/ffmpeg'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -LiteralPath $ffmpeg, $ffprobe -Destination $dest -Force

Write-Host "Copied to $dest"
foreach ($exe in 'ffmpeg.exe', 'ffprobe.exe') {
  Write-Host ((& (Join-Path $dest $exe) -version | Select-Object -First 1))
}
