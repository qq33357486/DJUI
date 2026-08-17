# 星火 Editor MCP 调用脚本
# 用法: mcp-call.ps1 -Method <tools/list|tools/call> -ToolName <name> [-ArgsJson "{}"]
param(
  [Parameter(Mandatory = $true)][string]$Method,
  [string]$ToolName = '',
  [string]$ArgsJson = '{}'
)
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8765/mcp'
$sessionFile = Join-Path $env:TEMP 'star-mcp-session.txt'
$nl = [string][char]10

function New-Headers {
  $h = @{ 'Accept' = 'application/json, text/event-stream' }
  if (Test-Path $sessionFile) {
    $sid = (Get-Content $sessionFile -Raw).Trim()
    if ($sid) { $h['mcp-session-id'] = $sid }
  }
  return $h
}

function Invoke-McpRequest($bodyObj) {
  $json = $bodyObj | ConvertTo-Json -Depth 10 -Compress
  $resp = Invoke-WebRequest -Uri $base -Method Post -Headers (New-Headers) -ContentType 'application/json' -Body $json -UseBasicParsing -TimeoutSec 300
  $newSid = $resp.Headers['mcp-session-id']
  if ($newSid) {
    if ($newSid -is [array]) { $newSid = $newSid[0] }
    Set-Content -Path $sessionFile -Value $newSid
  }
  return $resp
}

# 若无 session,先 initialize
if (-not (Test-Path $sessionFile)) {
  $initBody = @{
    jsonrpc = '2.0'; id = 0; method = 'initialize'
    params = @{
      protocolVersion = '2024-11-05'
      capabilities = @{}
      clientInfo = @{ name = 'dsh-agent'; version = '1.0' }
    }
  }
  [void](Invoke-McpRequest $initBody)
  $notif = @{ jsonrpc = '2.0'; method = 'notifications/initialized' } | ConvertTo-Json -Depth 5 -Compress
  [void](Invoke-WebRequest -Uri $base -Method Post -Headers (New-Headers) -ContentType 'application/json' -Body $notif -UseBasicParsing -TimeoutSec 60)
}

$body = @{ jsonrpc = '2.0'; id = 1; method = $Method; params = @{} }
if ($ToolName) {
  $body.params = @{ name = $ToolName; arguments = ($ArgsJson | ConvertFrom-Json) }
}

$resp = Invoke-McpRequest $body
$contentType = $resp.Headers['Content-Type']
if ($contentType -is [array]) { $contentType = $contentType[0] }
$raw = $resp.Content
if ($contentType -like '*event-stream*') {
  $dataLines = ($raw -split $nl) | Where-Object { $_ -match '^data:\s*(.+)$' } | ForEach-Object { $Matches[1] }
  $raw = $dataLines -join ''
}
Write-Output $raw