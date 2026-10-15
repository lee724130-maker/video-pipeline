# setup.ps1 · 新机器一键安装 whisper 环境（逐词字幕对齐 + KTV 识别兜底用）
# 用法：在项目根目录执行
#   powershell -ExecutionPolicy Bypass -File setup.ps1
# 说明：
# - 装 Python 3.12.9 到项目内 .py312\（与系统 Python 隔离，可随时删掉重装）
# - 依赖版本锁定见 requirements-whisper.txt（ctranslate2 4.5.0 等坑勿升级）
# - whisper 模型文件不随仓库走，首次使用时自动从 hf-mirror 下载到 cache\whisper\
# - 不跑本脚本也能用：主链路（口播成片）不依赖 whisper，只是字幕时间轴退回字数比例
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root '.py312\python.exe'
$pypi = 'https://repo.huaweicloud.com/repository/pypi/simple/'

if (Test-Path $py) {
  Write-Host ".py312 已存在（$( & $py --version )），跳过 Python 安装"
} else {
  $url = 'https://mirrors.huaweicloud.com/python/3.12.9/python-3.12.9-amd64.exe'
  $installer = Join-Path $env:TEMP 'python-3.12.9-amd64.exe'
  Write-Host "下载 Python 3.12.9（华为镜像）…"
  Invoke-WebRequest -Uri $url -OutFile $installer
  Write-Host '静默安装到 .py312\ …'
  Start-Process $installer -ArgumentList '/quiet', 'InstallAllUsers=0', "TargetDir=$root\.py312", 'Include_pip=1' -Wait
  Remove-Item $installer
}

Write-Host '安装锁定依赖（requirements-whisper.txt）…'
& $py -m pip install --upgrade pip -i $pypi
& $py -m pip install -r (Join-Path $root 'requirements-whisper.txt') -i $pypi

Write-Host ''
Write-Host '完成。验证：' -ForegroundColor Green
Write-Host "  $py -c `"from faster_whisper import WhisperModel; print('whisper ok')`""
