# First-time setup of the Windows test machine. Safe to run again.
# ASCII only: Windows PowerShell 5 reads scripts without BOM as ANSI.
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Set-ExecutionPolicy Bypass -Scope Process -Force
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$choco = 'C:\ProgramData\chocolatey\bin\choco.exe'
if (-not (Test-Path $choco)) {
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
}
& $choco install -y --no-progress git nodejs-lts visualstudio2022buildtools webview2-runtime librecad libreoffice-fresh 2>&1 | Select-Object -Last 2
& $choco install -y --no-progress visualstudio2022-workload-vctools --package-parameters "--includeRecommended" 2>&1 | Select-Object -Last 2

[Environment]::SetEnvironmentVariable('RUSTUP_HOME', 'C:\rust\rustup', 'Machine')
[Environment]::SetEnvironmentVariable('CARGO_HOME', 'C:\rust\cargo', 'Machine')
$env:RUSTUP_HOME = 'C:\rust\rustup'
$env:CARGO_HOME = 'C:\rust\cargo'
if (-not (Test-Path 'C:\rust\cargo\bin\cargo.exe')) {
    Invoke-WebRequest https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe -OutFile C:\rustup-init.exe
    # rustup writes progress to stderr, cmd keeps PowerShell from treating it as a failure
    cmd /c 'C:\rustup-init.exe -y --default-toolchain stable --profile minimal 2>&1' | Select-Object -Last 2
}
$path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if ($path -notlike '*C:\rust\cargo\bin*') {
    [Environment]::SetEnvironmentVariable('Path', "$path;C:\rust\cargo\bin", 'Machine')
}
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine')
cmd /c 'npm install -g pnpm 2>&1' | Select-Object -Last 1

# Network flyout after first logon holds the foreground and blocks window switching
New-Item -Path 'HKLM:\System\CurrentControlSet\Control\Network\NewNetworkWindowOff' -Force | Out-Null
Write-Output 'PROVISION_OK'
