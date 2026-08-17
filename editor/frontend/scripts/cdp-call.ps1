# CDP Runtime.evaluate 调用脚本
# 用法: cdp-call.ps1 -TargetUrl <ws url> -Expression <js>
param(
  [Parameter(Mandatory = $true)][string]$TargetUrl,
  [Parameter(Mandatory = $true)][string]$Expression
)

$ErrorActionPreference = 'Stop'
$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ct = [System.Threading.CancellationToken]::None

try {
  $ws.ConnectAsync([Uri]$TargetUrl, $ct).Wait() | Out-Null

  $payload = @{
    id      = 1
    method  = 'Runtime.evaluate'
    params  = @{
      expression   = $Expression
      awaitPromise = $true
      returnByValue = $true
    }
  } | ConvertTo-Json -Depth 5 -Compress

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait() | Out-Null

  $buffer = New-Object byte[] (4MB)
  $deadline = [DateTime]::UtcNow.AddSeconds(100)

  while ($true) {
    $text = ''
    do {
      $rx = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), $ct)
      if (-not $rx.Wait(100000)) { throw 'CDP receive timeout' }
      $text += [System.Text.Encoding]::UTF8.GetString($buffer, 0, $rx.Result.Count)
    } while (-not $rx.Result.EndOfMessage)

    $msg = $text | ConvertFrom-Json
    if ($msg.id -eq 1) {
      if ($msg.result.exceptionDetails) {
        Write-Output ('PAGE_EXCEPTION: ' + ($msg.result.exceptionDetails | ConvertTo-Json -Depth 10 -Compress))
      } else {
        Write-Output $msg.result.result.value
      }
      break
    }
    # 非目标消息(事件等),继续收
    if ([DateTime]::UtcNow -gt $deadline) { throw 'CDP response timeout' }
  }
} finally {
  $ws.Dispose()
}
