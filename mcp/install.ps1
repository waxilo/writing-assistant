# writing-assistant MCP server - Windows installer (single file, no npm needed)
#
# One-liner (uses the defaults below):
#   irm https://github.com/waxilo/writing-assistant/releases/latest/download/install.ps1 | iex
#
# The download base defaults to the GitHub Release, where server.mjs / latest.json /
# both installers sit flat in the same URL prefix. A mirror is served by the
# self-hosted container at https://writer.sloan.dpdns.org/download/mcp.
#
# Override the download source / install dir:
#   $env:WRITER_MCP_BASE = "https://writer.sloan.dpdns.org/download/mcp"
#   $env:WRITER_MCP_DIR  = "D:\tools\writer-mcp"
#   irm https://github.com/waxilo/writing-assistant/releases/latest/download/install.ps1 | iex
#
# Or save it first and pass parameters:
#   irm https://github.com/waxilo/writing-assistant/releases/latest/download/install.ps1 -OutFile install.ps1
#   .\install.ps1 -BaseUrl https://github.com/waxilo/writing-assistant/releases/latest/download -Force
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 decodes scripts without a
# BOM as the system ANSI codepage, so non-ASCII literals break parsing when the
# script is piped into Invoke-Expression.

param(
    [string]$BaseUrl = "",
    [string]$Dir = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $BaseUrl) { $BaseUrl = $env:WRITER_MCP_BASE }
if (-not $BaseUrl) { $BaseUrl = "https://github.com/waxilo/writing-assistant/releases/latest/download" }
if (-not $Dir) { $Dir = $env:WRITER_MCP_DIR }
if (-not $Dir) { $Dir = Join-Path $env:USERPROFILE ".writing-assistant-mcp" }

$base = $BaseUrl.TrimEnd("/")
$target = Join-Path $Dir "server.mjs"
$marker = Join-Path $Dir ".version"

Write-Host "-> reading $base/latest.json"
# Read the manifest as text and parse it ourselves: GitHub serves release assets as
# application/octet-stream, and Invoke-RestMethod only auto-parses JSON content
# types - on anything else it hands back raw bytes and $latest.version is empty.
$manifest = (Invoke-WebRequest -Uri "$base/latest.json" -UseBasicParsing).Content
if ($manifest -is [byte[]]) { $manifest = [System.Text.Encoding]::UTF8.GetString($manifest) }
$latest = $manifest | ConvertFrom-Json
if (-not $latest.version) { throw "no version field in latest.json, wrong download base? $base" }

$upToDate = $false
if ((Test-Path $target) -and (Test-Path $marker) -and (-not $Force)) {
    if ((Get-Content $marker -Raw).Trim() -eq $latest.version) { $upToDate = $true }
}

if ($upToDate) {
    Write-Host "OK already up to date: v$($latest.version) -> $target"
}
else {
    New-Item -ItemType Directory -Force -Path $Dir | Out-Null
    $tmp = "$target.download"
    Write-Host "-> downloading v$($latest.version) -> $target"
    Invoke-WebRequest -Uri "$base/$($latest.file)" -OutFile $tmp -UseBasicParsing

    if ($latest.sha256) {
        $actual = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLower()
        if ($actual -ne $latest.sha256.ToLower()) {
            Remove-Item $tmp -Force
            throw "sha256 mismatch: expected $($latest.sha256), got $actual"
        }
        Write-Host "OK sha256 verified"
    }

    Move-Item -Force $tmp $target
    Set-Content -Path $marker -Value $latest.version -NoNewline
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    Write-Host "OK node $(& node -v) ($($nodeCmd.Source))"
}
else {
    Write-Warning "node not found. Install Node.js 20+ (https://nodejs.org/) first, the MCP server needs it."
}

Write-Host ""
Write-Host "== step 1/2: log in once (credentials are stored in ~/.writer-mcp.json) =="
Write-Host "  node `"$target`" login"
Write-Host ""
Write-Host "== step 2/2: merge this into your MCP client config =="
Write-Host "   Claude Desktop: Settings -> Developer -> Edit Config (claude_desktop_config.json)"
Write-Host "   Cursor:         Settings -> MCP -> Add new MCP server -> command type"
Write-Host ""
Write-Host "(the JSON below is the complete content; restart the client afterwards)"
# Hand-formatted instead of ConvertTo-Json: PS 5.1 spreads nested objects over
# absurd amounts of whitespace, which is painful to paste.
$jsonPath = $target.Replace("\", "\\")
@"
{
  "mcpServers": {
    "writing-assistant": {
      "command": "node",
      "args": ["$jsonPath"]
    }
  }
}
"@
