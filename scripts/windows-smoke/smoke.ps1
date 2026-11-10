# Runs on the test machine: unpack source, unit tests, then UI tests inside the logged-in session.
# ASCII only: Windows PowerShell 5 reads scripts without BOM as ANSI.
param([Parameter(Mandatory = $true)][string]$Bucket, [string]$Prefix = 'smoke')
$ErrorActionPreference = 'Continue'
$env:RUSTUP_HOME = 'C:\rust\rustup'
$env:CARGO_HOME = 'C:\rust\cargo'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ";$env:APPDATA\npm"
$work = 'C:\w'
$out = 'C:\wt'
New-Item -ItemType Directory -Force $work, $out | Out-Null
icacls $out /grant Everyone:F /T | Out-Null
Get-ChildItem $out -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

'stavebak', 'cargo', 'claude', 'notepad', 'librecad', 'soffice.bin', 'soffice', 'mspaint', 'node' | ForEach-Object {
    Get-Process $_ -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Read-S3Object -BucketName $Bucket -Key "$Prefix/desktop.tgz" -File C:\desktop.tgz | Out-Null
# node_modules and target stay between runs, generated sources do not
Remove-Item -Recurse -Force "$work\src", "$work\src-tauri\src", "$work\dist" -ErrorAction SilentlyContinue
tar -xzf C:\desktop.tgz -C $work

$failed = @()
Set-Location $work
cmd /c "pnpm install --frozen-lockfile > $out\install.log 2>&1"
if ($LASTEXITCODE -ne 0) { $failed += 'pnpm install' }
cmd /c "pnpm build > $out\build.log 2>&1"
if ($LASTEXITCODE -ne 0) { $failed += 'pnpm build' }
cmd /c "pnpm exec vitest run > $out\vitest.log 2>&1"
if ($LASTEXITCODE -ne 0) { $failed += 'vitest' }
Select-String -Path "$out\vitest.log" -Pattern 'Test Files|Tests ' | ForEach-Object { 'vitest: ' + ($_.Line -replace '\x1b\[[0-9;]*m', '') }

Set-Location "$work\src-tauri"
cmd /c "cargo test --locked --lib > $out\cargo.log 2>&1"
if ($LASTEXITCODE -ne 0) { $failed += 'cargo test' }
Select-String -Path "$out\cargo.log" -Pattern '^test result|^error' | ForEach-Object { 'cargo: ' + $_.Line }

$match = Select-String -Path "$out\cargo.log" -Pattern 'Running unittests[^(]*\(([^)]+\.exe)\)' | Select-Object -First 1
if ($match) {
    $exe = $match.Matches[0].Groups[1].Value
    if ($exe -notmatch '^[A-Za-z]:') { $exe = "$work\src-tauri\$exe" }
    $cad = (Get-ChildItem 'C:\Program Files*\LibreCAD\LibreCAD.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
    $office = (Get-ChildItem 'C:\Program Files*\LibreOffice\program\soffice.exe' -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
    if (-not $cad) { $failed += 'LibreCAD missing' }
    if (-not $office) { $failed += 'LibreOffice missing' }
    $bat = @(
        '@echo off',
        "set STAVEBAK_WIN_OUT=$out",
        "set STAVEBAK_CAD_EXE=$cad",
        "set STAVEBAK_SOFFICE_EXE=$office",
        "cd /d $work\src-tauri",
        "`"$exe`" real_windows --ignored --nocapture --test-threads=1 > $out\ui.log 2>&1",
        "echo EXIT %ERRORLEVEL% >> $out\ui.log"
    ) -join "`r`n"
    Set-Content "$out\ui.bat" $bat -Encoding ASCII
    $action = New-ScheduledTaskAction -Execute "$out\ui.bat"
    $principal = New-ScheduledTaskPrincipal -UserId 'Administrator' -LogonType Interactive -RunLevel Highest
    Register-ScheduledTask -TaskName stavebak-ui -Action $action -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName stavebak-ui
    $waited = 0
    while ($waited -lt 900) {
        Start-Sleep 5
        $waited += 5
        if ((Test-Path "$out\ui.log") -and (Select-String -Path "$out\ui.log" -Pattern '^EXIT' -Quiet)) { break }
    }
    if (Test-Path "$out\ui.log") {
        Get-Content "$out\ui.log" -Encoding UTF8 | Select-String -Pattern '^test |panicked|^test result|tmavych|^EXIT' | ForEach-Object { 'ui: ' + $_.Line }
    }
    if (-not ((Test-Path "$out\ui.log") -and (Select-String -Path "$out\ui.log" -Pattern '^EXIT 0' -Quiet))) { $failed += 'UI tests' }
} else {
    $failed += 'test binary not found'
}

Get-ChildItem $out -File -Include *.jpg, *.log -Recurse | ForEach-Object {
    Write-S3Object -BucketName $Bucket -Key "$Prefix/out/$($_.Name)" -File $_.FullName | Out-Null
}
if ($failed.Count -eq 0) { 'SMOKE_RESULT=PASS' } else { 'SMOKE_RESULT=FAIL: ' + ($failed -join ', ') }
