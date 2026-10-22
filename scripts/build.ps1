param([string]$ToolSource = '', [string]$NodeSource = '', [string]$CpaSource = '')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$buildRoot = Join-Path $projectRoot '.build'
$inputRoot = Join-Path $buildRoot 'inputs'
$payloadRoot = Join-Path $buildRoot 'payload'
$distRoot = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Force -Path $buildRoot,$inputRoot,$distRoot | Out-Null
if (Test-Path -LiteralPath $payloadRoot) {
    $resolvedPayload = (Resolve-Path -LiteralPath $payloadRoot).Path
    $resolvedBuild = (Resolve-Path -LiteralPath $buildRoot).Path + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedPayload.StartsWith($resolvedBuild,[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid build staging path.' }
    Remove-Item -LiteralPath $resolvedPayload -Recurse -Force
}
$appRoot = Join-Path $payloadRoot 'app'
$runtimeRoot = Join-Path $payloadRoot 'runtime'
$licenseRoot = Join-Path $appRoot 'licenses'
New-Item -ItemType Directory -Force -Path $appRoot,$runtimeRoot,$licenseRoot,(Join-Path $appRoot 'src'),(Join-Path $appRoot 'public') | Out-Null
function Get-Input([string]$url,[string]$name,[string]$expected='') {
    $target = Join-Path $inputRoot $name
    $valid = (Test-Path -LiteralPath $target) -and (($expected -eq '') -or ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -eq $expected))
    if (-not $valid) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $target -TimeoutSec 240 }
    if ($expected -and ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected)) { throw "Checksum mismatch: $name" }
    return $target
}
$cpaHash = '4b54808ee28174dca5ac10f711d33958043609ed3dc0c92bbcef63329f3a59f3'
if ($CpaSource -and (Test-Path -LiteralPath $CpaSource)) {
    if ((Get-FileHash -LiteralPath $CpaSource -Algorithm SHA256).Hash.ToLowerInvariant() -ne $cpaHash) { throw 'Invalid CPA source archive.' }
    Copy-Item -LiteralPath $CpaSource -Destination (Join-Path $runtimeRoot 'cpa.zip')
} else {
    $cpaArchive = Get-Input 'https://github.com/router-for-me/CLIProxyAPI/releases/download/v8.0.38/CLIProxyAPI_8.0.38_windows_amd64.zip' 'cpa.zip' $cpaHash
    Copy-Item -LiteralPath $cpaArchive -Destination (Join-Path $runtimeRoot 'cpa.zip')
}
if ($ToolSource -and (Test-Path -LiteralPath (Join-Path $ToolSource 'uv\uv.exe'))) {
    Copy-Item -LiteralPath (Join-Path $ToolSource 'uv\uv.exe') -Destination (Join-Path $runtimeRoot 'uv.exe')
    $sdkRoot = Join-Path $ToolSource 'webview2'
} else {
    $uvZip = Get-Input 'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip' 'uv.zip' 'a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a'
    $uvRoot = Join-Path $inputRoot 'uv'
    Expand-Archive -LiteralPath $uvZip -DestinationPath $uvRoot -Force
    Copy-Item -LiteralPath (Join-Path $uvRoot 'uv.exe') -Destination (Join-Path $runtimeRoot 'uv.exe')
    $sdkZip = Get-Input 'https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/1.0.4258.31/microsoft.web.webview2.1.0.4258.31.nupkg' 'webview2.zip'
    $sdkRoot = Join-Path $inputRoot 'webview2'
    Expand-Archive -LiteralPath $sdkZip -DestinationPath $sdkRoot -Force
}
if ($NodeSource -and (Test-Path -LiteralPath $NodeSource)) {
    Copy-Item -LiteralPath $NodeSource -Destination (Join-Path $runtimeRoot 'node.exe')
} else {
    $nodeSums = Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/v24.19.0/SHASUMS256.txt'
    $nodeHash = (($nodeSums.Content -split '\r?\n' | Where-Object { $_ -match ' win-x64/node.exe$' }) -split '\s+')[0]
    if (-not $nodeHash) { throw 'Cannot find official Node.js checksum.' }
    $nodeExe = Get-Input 'https://nodejs.org/dist/v24.19.0/win-x64/node.exe' 'node.exe' $nodeHash
    Copy-Item -LiteralPath $nodeExe -Destination (Join-Path $runtimeRoot 'node.exe')
}
Copy-Item -LiteralPath (Join-Path $sdkRoot 'lib\net462\Microsoft.Web.WebView2.Core.dll'),(Join-Path $sdkRoot 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'),(Join-Path $sdkRoot 'build\native\x64\WebView2Loader.dll') -Destination $runtimeRoot
Copy-Item -LiteralPath (Join-Path $projectRoot 'src\server.mjs'),(Join-Path $projectRoot 'src\napcat.mjs') -Destination (Join-Path $appRoot 'src')
Copy-Item -LiteralPath (Join-Path $projectRoot 'public\workbench.html'),(Join-Path $projectRoot 'public\style.css'),(Join-Path $projectRoot 'public\workbench.js') -Destination (Join-Path $appRoot 'public')
Copy-Item -LiteralPath (Join-Path $projectRoot 'requirements-windows.lock'),(Join-Path $projectRoot 'LICENSE'),(Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination $appRoot
$licenses = @(
    @('https://raw.githubusercontent.com/nodejs/node/v24.19.0/LICENSE','Node-LICENSE.txt'),
    @('https://raw.githubusercontent.com/astral-sh/uv/0.13.5/LICENSE-MIT','uv-LICENSE-MIT.txt'),
    @('https://raw.githubusercontent.com/astral-sh/uv/0.13.5/LICENSE-APACHE','uv-LICENSE-APACHE.txt'),
    @('https://raw.githubusercontent.com/router-for-me/CLIProxyAPI/v8.0.38/LICENSE','CPA-LICENSE.txt')
)
foreach($item in $licenses) { $licenseFile = Get-Input $item[0] $item[1]; Copy-Item -LiteralPath $licenseFile -Destination $licenseRoot }
Get-ChildItem -LiteralPath $sdkRoot -File | Where-Object { $_.Name -match 'LICENSE' } | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $licenseRoot ('WebView2-'+$_.Name)) }
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 256,256
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([Drawing.Color]::FromArgb(27,77,59))
$font = New-Object System.Drawing.Font 'Georgia',170,([Drawing.FontStyle]::Regular),([Drawing.GraphicsUnit]::Pixel)
$brush = New-Object System.Drawing.SolidBrush ([Drawing.Color]::FromArgb(216,248,228))
$graphics.DrawString('q',$font,$brush,25,0)
$starFont = New-Object System.Drawing.Font 'Segoe UI Symbol',42,([Drawing.FontStyle]::Regular),([Drawing.GraphicsUnit]::Pixel)
$graphics.DrawString('✦',$starFont,$brush,185,18)
$icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
$iconFile = Join-Path $appRoot 'icon.ico'
$iconStream = [IO.File]::Create($iconFile)
$icon.Save($iconStream);$iconStream.Dispose();$graphics.Dispose();$bitmap.Dispose();$font.Dispose();$starFont.Dispose();$brush.Dispose()
Add-Type -AssemblyName System.IO.Compression.FileSystem
$payloadZip = Join-Path $buildRoot 'payload.zip'
if(Test-Path -LiteralPath $payloadZip) { Remove-Item -LiteralPath $payloadZip -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot,$payloadZip,[IO.Compression.CompressionLevel]::Optimal,$false)
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$outputExe = Join-Path $distRoot 'QQBotWorkbench-0.1.0-win-x64.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ /debug- "/out:$outputExe" "/win32icon:$iconFile" "/resource:$payloadZip,payload.zip" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Web.Extensions.dll "/r:$(Join-Path $runtimeRoot 'Microsoft.Web.WebView2.Core.dll')" "/r:$(Join-Path $runtimeRoot 'Microsoft.Web.WebView2.WinForms.dll')" (Join-Path $projectRoot 'desktop\Program.cs')
if($LASTEXITCODE -ne 0) { throw 'Windows executable compilation failed.' }
$hash=(Get-FileHash -LiteralPath $outputExe -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($outputExe))" | Set-Content -LiteralPath (Join-Path $distRoot 'SHA256SUMS.txt') -Encoding ascii
@{ version='0.1.0'; tag='v0.1.0'; filename=[IO.Path]::GetFileName($outputExe); sha256=$hash } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot 'release.json') -Encoding utf8
@{ file=[IO.Path]::GetFileName($outputExe); bytes=(Get-Item -LiteralPath $outputExe).Length; sha256=$hash; version='0.1.0' } | ConvertTo-Json
