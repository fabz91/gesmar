# GES - installe la tache Windows « GES - demarque Videor » (export toutes les heures, lecture seule de la base Videor)
$ErrorActionPreference = 'Stop'
$dest = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'CLAUDE CODE\DEMARQUE'  # hors des dossiers de Videor
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force (Join-Path $PSScriptRoot 'export-demarque.ps1') (Join-Path $dest 'export-demarque.ps1')
$ps = Join-Path $dest 'export-demarque.ps1'
# tache : chaque jour de 8 h 05 a 23 h 05, toutes les heures (compte Windows connecte)
$act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ps + '"')
$trg = New-ScheduledTaskTrigger -Daily -At '08:05'
$trg.Repetition = (New-ScheduledTaskTrigger -Once -At '08:05' -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Hours 15)).Repetition
$set = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName 'GES - demarque Videor' -Action $act -Trigger $trg -Settings $set -Description 'GES : export de la demarque Videor (lecture seule) pour GESMAR' -Force | Out-Null
Write-Host 'Tache Windows « GES - demarque Videor » creee (toutes les heures de 8 h a 23 h).'
Write-Host ''
Write-Host 'Premier export (historique depuis le 01/01/2025)...'
& $ps -Depuis '2025-01-01'
Write-Host ''
Write-Host 'Termine. La demarque sera exportee toutes les heures dans Documents\CLAUDE CODE\DEMARQUE et lue par GESMAR.'
