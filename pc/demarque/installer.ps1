# GES - installe la tache Windows « GES - demarque Videor » (export toutes les heures, lecture seule de la base Videor)
$ErrorActionPreference = 'Stop'
$dest = 'C:\transfert\demarque'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'export-demarque.ps1') (Join-Path $dest 'export-demarque.ps1')
$ps = Join-Path $dest 'export-demarque.ps1'
$tr = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ps + '"'
schtasks.exe /Create /TN 'GES - demarque Videor' /TR $tr /SC HOURLY /MO 1 /ST 08:05 /F | Out-Host
Write-Host ''
Write-Host 'Premier export (historique depuis le 01/01/2025)...'
& $ps -Depuis '2025-01-01'
Write-Host ''
Write-Host 'Termine. La demarque sera exportee toutes les heures dans C:\transfert\demarque et lue par GESMAR.'
