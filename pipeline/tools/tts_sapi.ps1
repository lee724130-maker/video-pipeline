# tts_sapi.ps1 · SAPI 离线 TTS 兜底：narration.txt → wav（Windows 自带语音，零联网零额度）
# 用法: powershell -NoProfile -ExecutionPolicy Bypass -File tts_sapi.ps1 -TextFile narration.txt -WavPath out.wav [-Voice "Microsoft Huihui Desktop"] [-Rate 2]
#       powershell ... -List    # 只列出可用语音（00-checkenv 用）
# 音色优先级：指定 Voice > zh-CN 语音 > 任意可用语音
param(
  [string]$TextFile = '',
  [string]$WavPath = '',
  [string]$Voice = '',
  [int]$Rate = 2,          # SAPI 语速 -10..10
  [switch]$List
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($s.GetInstalledVoices())

if ($List) {
  foreach ($vo in $voices) {
    $v = $vo.VoiceInfo
    Write-Output ("{0}|{1}" -f $v.Name, $v.Culture)
  }
  $s.Dispose()
  exit 0
}

if (-not $TextFile -or -not $WavPath) { Write-Error '需要 -TextFile 和 -WavPath'; exit 2 }
if (-not (Test-Path $TextFile)) { Write-Error "文本不存在: $TextFile"; exit 2 }

$pick = $null
if ($Voice) { $pick = $voices | Where-Object { $_.VoiceInfo.Name -eq $Voice } | Select-Object -First 1 }
if (-not $pick) { $pick = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1 }
if (-not $pick) { $pick = $voices | Select-Object -First 1 }
if (-not $pick) { Write-Error 'NO_VOICE：系统无任何 SAPI 语音'; exit 3 }

$s.SelectVoice($pick.VoiceInfo.Name)
$s.Rate = $Rate
$text = [System.IO.File]::ReadAllText((Resolve-Path $TextFile), [System.Text.Encoding]::UTF8)
$s.SetOutputToWaveFile($WavPath)
$s.Speak($text)
$s.Dispose()
Write-Output ("VOICE:{0} RATE:{1} CHARS:{2}" -f $pick.VoiceInfo.Name, $Rate, $text.Length)
