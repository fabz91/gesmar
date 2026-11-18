# GES - export automatique de la demarque Videor (LECTURE SEULE de la base SQL Server de Videor)
# Lit les releves "Casses et Demarques" (table DOCUMENTS, TYPDOC = 'Q') et leurs produits (LIGNES_DOCUMENT),
# puis ecrit :
#  - Documents\CLAUDE CODE\DEMARQUE\demarque.csv (meme format que l'export Videor, pour controle)
#  - demarque-videor.json dans le dossier des donnees de GESMAR (lu automatiquement par GESMAR)
# Aucune ecriture dans la base : seulement des SELECT, sans verrou (READ UNCOMMITTED), connexion en lecture seule.
param([int]$Jours = 62, [string]$Depuis = '')
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture
$dossier = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'CLAUDE CODE\DEMARQUE'  # hors des dossiers de Videor
New-Item -ItemType Directory -Force -Path $dossier | Out-Null
$log = Join-Path $dossier 'export-demarque.log'
function Log($m) { $l = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $m; Add-Content -Path $log -Value $l -Encoding UTF8; Write-Host $l }
try { if ((Get-Item $log -ErrorAction SilentlyContinue).Length -gt 200KB) { Remove-Item $log -Force } } catch {}

function Lire($cs, $sql) {
  $cn = New-Object System.Data.SqlClient.SqlConnection $cs
  $cn.Open()
  try {
    $cmd = $cn.CreateCommand(); $cmd.CommandTimeout = 120
    $cmd.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ' + $sql
    $t = New-Object System.Data.DataTable
    $t.Load($cmd.ExecuteReader())
    return ,$t
  } finally { $cn.Close() }
}

try {
  # 1) serveur et base de Videor (instance VIDEOR, base G20_...)
  $srv = '.\VIDEOR'
  if (-not (Get-Service -Name 'MSSQL$VIDEOR' -ErrorAction SilentlyContinue)) { throw 'Service SQL Server (VIDEOR) introuvable sur ce PC' }
  $csM = "Server=$srv;Database=master;Integrated Security=SSPI;Connect Timeout=15;Application Name=GES-demarque;ApplicationIntent=ReadOnly"
  $b = Lire $csM "SELECT name FROM sys.databases WHERE name LIKE 'G20%' ORDER BY name"
  if ($b.Rows.Count -lt 1) { throw 'Base G20_... introuvable' }
  $db = [string]$b.Rows[0].name
  $mag = if ($db -match 'CLAMART') { 'clamart' } elseif ($db -match 'LONGJUMEAU|BREDIS') { 'bredis' } else { '' }
  $raisoc = $db -replace '_', ' '
  $cs = "Server=$srv;Database=$db;Integrated Security=SSPI;Connect Timeout=15;Application Name=GES-demarque;ApplicationIntent=ReadOnly"

  # 2) colonnes disponibles (la structure peut changer avec une mise a jour de Videor)
  $C = Lire $cs "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME IN ('LIGNES_DOCUMENT','ARTICLE','DOCUMENTS')"
  $col = @{}; foreach ($r in $C.Rows) { $col[([string]$r.TABLE_NAME + '.' + [string]$r.COLUMN_NAME).ToUpper()] = 1 }
  function A($t, $n) { return $col.ContainsKey(($t + '.' + $n).ToUpper()) }
  function Pr($t, $noms) { foreach ($n in $noms) { if (A $t $n) { return $n } }; return $null }
  $lien = A 'LIGNES_DOCUMENT' 'ID_DOCUM'
  $joinArt = (A 'LIGNES_DOCUMENT' 'ID_ART') -and (A 'ARTICLE' 'ID_ART')
  $codes = @('COD_ART', 'CODE_ART', 'CODART', 'CODE', 'CODE_ARTICLE')
  $eans = @('EAN', 'GENCOD', 'CODE_EAN', 'EAN13')
  $x = Pr 'LIGNES_DOCUMENT' $codes; $cCode = if ($x) { "l.[$x]" } elseif ($joinArt -and ($y = Pr 'ARTICLE' $codes)) { "a.[$y]" } else { "''" }
  $x = Pr 'LIGNES_DOCUMENT' $eans; $cEan = if ($x) { "l.[$x]" } elseif ($joinArt -and ($y = Pr 'ARTICLE' $eans)) { "a.[$y]" } else { "''" }
  $x = Pr 'LIGNES_DOCUMENT' @('PX_UNIT_HT', 'PU_HT', 'PXUNIT_HT', 'PX_HT'); $cPuHt = if ($x) { "l.[$x]" } else { 'NULL' }
  $x = Pr 'LIGNES_DOCUMENT' @('PX_UNIT_TTC', 'PU_TTC', 'PXUNIT_TTC', 'PX_TTC'); $cPuTtc = if ($x) { "l.[$x]" } else { 'NULL' }

  if ($Depuis -match '^\d{4}-\d{2}-\d{2}$') { $dep = $Depuis } else { $dep = (Get-Date).AddDays(-$Jours).ToString('yyyy-MM-dd') }
  $depSql = $dep -replace '-', ''  # AAAAMMJJ : sans ambiguite quelle que soit la langue de SQL Server
  if ($lien) {
    $sql = "SELECT d.TYPTIERS, d.TYPDOC, d.NODOC, d.DATE_DOC, d.TOT_HT, d.TOT_TTC, l.TYPLIG, $cCode AS CODE, $cEan AS EAN, l.DESIG_LIG, l.QTE_CDE, $cPuHt AS PX_UNIT_HT, $cPuTtc AS PX_UNIT_TTC, l.TOT_HT AS TOT_HT_LIGNE, l.TOT_TTC AS TOT_TTC_LIGNE, l.NOLIG " +
           "FROM DOCUMENTS d LEFT JOIN LIGNES_DOCUMENT l ON l.ID_DOCUM = d.ID_DOCUM " + $(if ($joinArt) { 'LEFT JOIN ARTICLE a ON a.ID_ART = l.ID_ART ' } else { '' }) +
           "WHERE d.TYPDOC = 'Q' AND d.DATE_DOC >= '$depSql' ORDER BY d.NODOC, l.NOLIG"
  } else {
    Log 'Attention : lien releve -> produits introuvable (ID_DOCUM) : export des releves sans le detail des produits'
    $sql = "SELECT d.TYPTIERS, d.TYPDOC, d.NODOC, d.DATE_DOC, d.TOT_HT, d.TOT_TTC, '' AS TYPLIG, '' AS CODE, '' AS EAN, '' AS DESIG_LIG, NULL AS QTE_CDE, NULL AS PX_UNIT_HT, NULL AS PX_UNIT_TTC, NULL AS TOT_HT_LIGNE, NULL AS TOT_TTC_LIGNE, NULL AS NOLIG FROM DOCUMENTS d WHERE d.TYPDOC = 'Q' AND d.DATE_DOC >= '$depSql' ORDER BY d.NODOC"
  }
  $T = Lire $cs $sql

  # 3) CSV au format de l'export Videor « Casses et Demarques »
  function V($v) { if ($v -eq $null -or $v -is [DBNull]) { return '' }; if ($v -is [datetime]) { return $v.ToString('dd/MM/yyyy') }; if ($v -is [decimal] -or $v -is [double]) { return ([decimal]$v).ToString($inv) }; return (([string]$v) -replace '[;\r\n]', ' ').Trim() }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.AppendLine('CODTIERS;RAISOC;TYPTIERS;TYPDOC;NODOC;DATE_DOC;TOT_HT;TOT_TTC;TYPLIG;CODE;EAN;DESIG_LIG;QTE_CDE;PX_UNIT_HT;PX_UNIT_TTC;CODE_TVA;TOT_HT_LIGNE;TOT_TTC_LIGNE;PV_TTC;NBR_COLIS;NOLIG')
  $rel = @{}
  foreach ($r in $T.Rows) {
    $rel[[string]$r.NODOC] = 1
    $f = @('', $raisoc, (V $r.TYPTIERS), (V $r.TYPDOC), (V $r.NODOC), (V $r.DATE_DOC), (V $r.TOT_HT), (V $r.TOT_TTC), (V $r.TYPLIG), (V $r.CODE), (V $r.EAN), (V $r.DESIG_LIG), (V $r.QTE_CDE), (V $r.PX_UNIT_HT), (V $r.PX_UNIT_TTC), '', (V $r.TOT_HT_LIGNE), (V $r.TOT_TTC_LIGNE), '', '', (V $r.NOLIG))
    [void]$sb.AppendLine($f -join ';')
  }
  $csv = $sb.ToString()
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText((Join-Path $dossier 'demarque.csv'), $csv, (New-Object System.Text.UTF8Encoding($true)))

  # 4) fichier lu par GESMAR (dossier des donnees : GES\GESMAR\donnees, sinon ancien GESMAR\donnees)
  $o = [ordered]@{ v = 1; quand = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'); base = $db; mag = $mag; depuis = $dep; nb = $rel.Count; lignes = $T.Rows.Count; csv = $csv }
  $json = $o | ConvertTo-Json -Compress
  $cibles = @((Join-Path $env:APPDATA 'GES\GESMAR\donnees'), (Join-Path $env:APPDATA 'GESMAR\donnees')) | Where-Object { Test-Path $_ }
  if (-not $cibles) { throw 'Dossier des donnees de GESMAR introuvable (GES installe ?)' }
  foreach ($d in $cibles) { $f = Join-Path $d 'demarque-videor.json'; [IO.File]::WriteAllText($f + '.tmp', $json, $utf8); Move-Item -Force ($f + '.tmp') $f }
  Log ("OK : base $db, " + $rel.Count + ' releves, ' + $T.Rows.Count + " lignes depuis le $dep -> " + ($cibles -join ', '))
} catch {
  Log ('ERREUR : ' + $_.Exception.Message)
  exit 1
}
