# Logged-in desktop session for UI tests. The password is random and is kept only in the Winlogon
# registry key of this disposable machine, never in a file. The machine has no inbound ports.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web
$password = [System.Web.Security.Membership]::GeneratePassword(24, 4)
net user Administrator $password | Out-Null
$key = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
Set-ItemProperty $key AutoAdminLogon '1'
Set-ItemProperty $key DefaultUserName 'Administrator'
Set-ItemProperty $key DefaultPassword $password
powercfg /change monitor-timeout-ac 0
Write-Output 'AUTOLOGON_OK'
