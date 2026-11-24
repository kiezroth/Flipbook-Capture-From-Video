<#
.SYNOPSIS
  Copies ffmpeg.exe and ffprobe.exe (plus their DLLs for a shared build, and the build's LICENSE/README) into
  vendor/ffmpeg so the installer can bundle them.
.PARAMETER From
  Folder holding the binaries (the build's bin folder). Default: the folder of `ffmpeg` found on PATH.
  Nothing is downloaded.
.PARAMETER To
  Destination folder. Default: vendor/ffmpeg in the repository.
#>
param([string]$From, [string]$To)

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

# A shared build (e.g. gyan.dev "full_build-shared") keeps the libraries in DLLs next to the exes.
$dlls = @(Get-ChildItem -LiteralPath $From -File | Where-Object { $_.Name -match '^(av|sw|postproc).*\.dll$' })
if ($dlls.Count -gt 0) {
  Write-Host "Found a shared ffmpeg build: $($dlls.Count) DLLs ($(($dlls | ForEach-Object Name) -join ', '))"
} else {
  Write-Host 'Found a static ffmpeg build (no av*/sw*/postproc* DLLs next to ffmpeg.exe)'
}

# License and readme live in the build's root folder (the parent of bin).
$root = Split-Path -Parent ((Resolve-Path -LiteralPath $From).Path)
$docs = @()
if ($root) {
  $docs = @(Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Name -like 'LICENSE*' -or $_.Name -like 'README*' })
}
if ($docs.Count -eq 0) {
  Write-Warning "No LICENSE*/README* found in $root; the installer will ship ffmpeg without its license text. Add it to vendor/ffmpeg by hand."
}

if (-not $To) { $To = Join-Path (Split-Path -Parent $PSScriptRoot) 'vendor/ffmpeg' }
New-Item -ItemType Directory -Force -Path $To | Out-Null
# leftovers of a previous run (another build variant) must not be shipped
Get-ChildItem -LiteralPath $To -File | Where-Object { $_.Name -match '\.dll$' -or $_.Name -like 'LICENSE*' -or $_.Name -like 'README*' } |
  Remove-Item -Force
Copy-Item -LiteralPath $ffmpeg, $ffprobe -Destination $To -Force
foreach ($f in $dlls + $docs) { Copy-Item -LiteralPath $f.FullName -Destination $To -Force }

Write-Host "Copied to $To"
foreach ($f in $docs) { Write-Host "  $($f.Name)" }
foreach ($exe in 'ffmpeg.exe', 'ffprobe.exe') {
  Write-Host ((& (Join-Path $To $exe) -version | Select-Object -First 1))
}
