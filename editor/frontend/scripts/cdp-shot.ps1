# CDP Page.captureScreenshot 截图脚本
# 用法: cdp-shot.ps1 -TargetUrl <ws> -OutFile <png>
param(
  [Parameter(Mandatory = $true)][string]$TargetUrl,
  [Parameter(Mandatory = $true)][string]$OutFile
)
$ErrorActionPreference = 'Stop'
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ct = [System.Threading.CancellationToken]::None
try {
  $ws.ConnectAsync([Uri]$TargetUrl, $ct).Wait() | Out-Null
  $payload = @{ id = 1; method = 'Page.captureScreenshot'; params = @{ format = 'png' } } | ConvertTo-Json -Depth 4 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait() | Out-Null
  $buffer = New-Object byte[] (16MB)
  while ($true) {
    $text = ''
    do {
      $rx = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), $ct)
      if (-not $rx.Wait(60000)) { throw 'CDP receive timeout' }
      $text += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $rx.Result.Count)
    } while (-not $rx.Result.EndOfMessage)
    $msg = $text | ConvertFrom-Json
    if ($msg.id -eq 1) {
      [System.IO.File]::WriteAllBytes($OutFile, [Convert]::FromBase64String($msg.result.data))
      Write-Output ('SAVED ' + (Get-Item $OutFile).Length + ' bytes')
      break
    }
  }
} finally { $ws.Dispose() }