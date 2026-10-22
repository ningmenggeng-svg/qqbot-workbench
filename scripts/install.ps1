param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')][string]$Repository,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'QQBotWorkbench\installer')
)
$ErrorActionPreference = 'Stop'
$manifest = Invoke-RestMethod -Uri "https://raw.githubusercontent.com/$Repository/main/release.json" -Headers @{ 'User-Agent'='QQBotWorkbench-Installer' }
if ($manifest.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or $manifest.tag -ne ('v'+$manifest.version) -or $manifest.filename -ne ('QQBotWorkbench-'+$manifest.version+'-win-x64.exe') -or $manifest.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw '发行版清单格式不正确，已停止。' }
$downloadUrl = "https://github.com/$Repository/releases/download/$($manifest.tag)/$($manifest.filename)"
New-Item -ItemType Directory -Force -Path $InstallDirectory | Out-Null
$target = Join-Path $InstallDirectory $manifest.filename
Invoke-WebRequest -UseBasicParsing -Uri $downloadUrl -OutFile $target -TimeoutSec 600
if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256.ToLowerInvariant()) { throw '安装包校验未通过，已停止启动。' }
Write-Output "已验证 $($manifest.filename)，正在打开工作台。"
Start-Process -FilePath $target
