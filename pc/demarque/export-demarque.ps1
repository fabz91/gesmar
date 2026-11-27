# GES - export automatique de la demarque Videor (LECTURE SEULE de la base SQL Server de Videor)
# Lit les releves "Casses et Demarques" (table DOCUMENTS, TYPDOC = 'Q') et leurs produits (LIGNES_DOCUMENT),
# puis ecrit :
#  - Documents\CLAUDE CODE\DEMARQUE\demarque.csv (meme format que l'export Videor, pour controle)
#  - demarque-videor.json dans le dossier des donnees de GESMAR (lu automatiquement par GESMAR)
# Une fois par jour (ou avec -Articles), actualise aussi les fichiers articles de Videor (prix de vente, prix d'achat,
# colisage, codes-barres, rayons, fournisseurs, stock) dans Documents\CLAUDE CODE\ARTICLES.
# Aucune ecriture dans la base : seulement des SELECT, sans verrou (READ UNCOMMITTED), connexion en lecture seule.
param([int]$Jours = 62, [string]$Depuis = '', [switch]$Articles)
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

$echec = 0; $cs = $null
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
  $echec = 1
}

# 5) fichiers articles : une fois par jour (le premier passage apres 20 h sans mise a jour), ou tout de suite avec -Articles
try {
  $dosArt = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'CLAUDE CODE\ARTICLES'
  New-Item -ItemType Directory -Force -Path $dosArt | Out-Null
  $repere = Join-Path $dosArt 'articles-derniere-mise-a-jour.txt'
  $vieux = -not (Test-Path $repere) -or ((Get-Date) - (Get-Item $repere).LastWriteTime).TotalHours -ge 20
  if (($Articles -or $vieux) -and $cs) {
    $t0 = Get-Date
    $fr = [Globalization.CultureInfo]::GetCultureInfo('fr-FR')
    $bom = New-Object System.Text.UTF8Encoding($true)
    # ecrit le resultat d'une requete dans un CSV (« ; », virgule decimale, ouvrable dans Excel), ligne par ligne
    function Ecrire($sql, $fichier) {
      $cn = New-Object System.Data.SqlClient.SqlConnection $cs; $cn.Open()
      $tmp = $fichier + '.tmp'
      $w = New-Object IO.StreamWriter($tmp, $false, $bom)
      try {
        $cmd = $cn.CreateCommand(); $cmd.CommandTimeout = 300
        $cmd.CommandText = 'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; ' + $sql
        $rd = $cmd.ExecuteReader(); $n = 0
        $w.WriteLine(((0..($rd.FieldCount - 1)) | ForEach-Object { $rd.GetName($_) }) -join ';')
        $nc = $rd.FieldCount; $vals = New-Object object[] $nc; $parts = New-Object string[] $nc
        while ($rd.Read()) {
          [void]$rd.GetValues($vals)
          for ($i = 0; $i -lt $nc; $i++) {
            $v = $vals[$i]
            if ($v -is [DBNull]) { $parts[$i] = '' }
            elseif ($v -is [string]) { $parts[$i] = $v.Replace(';', ' ').Replace("`r", ' ').Replace("`n", ' ').Trim() }
            elseif ($v -is [datetime]) { $parts[$i] = $v.ToString('dd/MM/yyyy') }
            elseif ($v -is [decimal] -or $v -is [double] -or $v -is [single]) { $parts[$i] = ([decimal]$v).ToString($fr) }
            else { $parts[$i] = [string]$v }
          }
          $w.WriteLine([string]::Join(';', $parts)); $n++
        }
        $rd.Close()
      } finally { $w.Close(); $cn.Close() }
      Move-Item -Force $tmp $fichier
      return $n
    }
    $toutesCols = Lire $cs "SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS"
    $ca = @{}; $tab = @{}
    foreach ($r in $toutesCols.Rows) { $ca[([string]$r.TABLE_NAME + '.' + [string]$r.COLUMN_NAME).ToUpper()] = 1; $tab[([string]$r.TABLE_NAME).ToUpper()] = 1 }
    function AC($t, $n) { return $ca.ContainsKey(($t + '.' + $n).ToUpper()) }
    function PC($t, $noms) { foreach ($n in $noms) { if (AC $t $n) { return $n } }; return $null }
    $magU = if ($mag) { $mag.ToUpper() } else { 'VIDEOR' }
    $bilan = @()

    # a) une copie complete de chaque table utile (TIERS : code et nom seulement, sans adresses)
    $tables = @('ARTICLE', 'ARTICLE_COMPLEMENT', 'NOMENCLATURE', 'CODE_VENTE', 'REFERENCEMENT', 'REFERFOU', 'TARIF_FOU', 'STOCK', 'DIAPAR_ASSORT', 'PROMOTION', 'PROMO_MAG')
    foreach ($tb in $tables) {
      if (-not $tab.ContainsKey($tb)) { continue }
      try { $n = Ecrire "SELECT TOP 500000 * FROM [$tb]" (Join-Path $dosArt "$tb.csv"); $bilan += "$tb $n" } catch { Log ("Articles : table $tb non lue (" + $_.Exception.Message + ')') }
    }
    if ($tab.ContainsKey('TIERS')) {
      $ct = @('ID_TIERS', 'CODTIERS', 'TYPTIERS', 'RAISOC', 'NOM') | Where-Object { AC 'TIERS' $_ }
      if ($ct) { try { $n = Ecrire ('SELECT ' + (($ct | ForEach-Object { "[$_]" }) -join ', ') + ' FROM TIERS') (Join-Path $dosArt 'TIERS.csv'); $bilan += "TIERS $n" } catch { Log ('Articles : TIERS non lu (' + $_.Exception.Message + ')') } }
    }

    # b) fichier complet : une ligne par article (colonnes absentes de cette version de Videor = vides)
    function K($al, $t, $n, $nom) { if (AC $t $n) { return "$al.[$n] AS [$nom]" } else { return "NULL AS [$nom]" } }
    $sel = @((K 'a' 'ARTICLE' 'COD_ART' 'CODE'), (K 'a' 'ARTICLE' 'DESCRIP1' 'LIBELLE'))
    $from = 'FROM ARTICLE a'
    if ((AC 'CODE_VENTE' 'ID_ART') -and (AC 'CODE_VENTE' 'EAN')) {
      $o = if (AC 'CODE_VENTE' 'ORDRE') { 'ORDER BY c.ORDRE' } else { '' }
      $w2 = if (AC 'CODE_VENTE' 'DATSUP') { 'AND c.DATSUP IS NULL' } else { '' }
      $sel += 'cv.EAN AS [EAN]'; $from += " OUTER APPLY (SELECT TOP 1 c.EAN FROM CODE_VENTE c WHERE c.ID_ART = a.ID_ART $w2 $o) cv"
    } else { $sel += 'NULL AS [EAN]' }
    # rayon : sous-famille -> famille -> rayon -> departement
    $nk = PC 'NOMENCLATURE' @('ID_NOMEN'); $nl = PC 'NOMENCLATURE' @('LIBNOMEN', 'LIB_NOMEN', 'LIBELLE', 'LIBEL', 'DESIGNATION', 'DESCRIP1', 'NOM')
    if ($nk -and $nl -and (AC 'NOMENCLATURE' 'ID_NIVSUP') -and (AC 'ARTICLE' 'ID_NOMEN')) {
      $from += ' LEFT JOIN NOMENCLATURE n1 ON n1.ID_NOMEN = a.ID_NOMEN LEFT JOIN NOMENCLATURE n2 ON n2.ID_NOMEN = n1.ID_NIVSUP LEFT JOIN NOMENCLATURE n3 ON n3.ID_NOMEN = n2.ID_NIVSUP LEFT JOIN NOMENCLATURE n4 ON n4.ID_NOMEN = n3.ID_NIVSUP'
      $sel += "n4.[$nl] AS [DEPARTEMENT]", "n3.[$nl] AS [RAYON]", "n2.[$nl] AS [FAMILLE]", "n1.[$nl] AS [SOUS_FAMILLE]"
    } else { $sel += 'NULL AS [DEPARTEMENT]', 'NULL AS [RAYON]', 'NULL AS [FAMILLE]', 'NULL AS [SOUS_FAMILLE]' }
    $sel += (K 'a' 'ARTICLE' 'TYPUNIT' 'UNITE'), (K 'a' 'ARTICLE' 'CODETVA' 'CODE_TVA')
    # prix magasin (REFERENCEMENT)
    $okR = AC 'REFERENCEMENT' 'ID_ART'
    $oR = if (AC 'REFERENCEMENT' 'ID_TIERS_MAG') { 'ORDER BY CASE WHEN x.ID_TIERS_MAG = 2 THEN 0 ELSE 1 END' } else { '' }  # 2 = le magasin
    if ($okR) { $from += " OUTER APPLY (SELECT TOP 1 * FROM REFERENCEMENT x WHERE x.ID_ART = a.ID_ART $oR) r" }
    foreach ($p in @(@('PVTTC', 'PV_TTC'), @('PVHT', 'PV_HT'), @('APVTTC', 'ANCIEN_PV_TTC'), @('PA_NET_MAG', 'PA_NET'), @('PA_BRUT_MAG', 'PA_BRUT'), @('DATE_TARIF', 'DATE_TARIF'), @('FLG_PROMO', 'PROMO'), @('DEFERENCE', 'DEREFERENCE'))) {
      if ($okR) { $sel += (K 'r' 'REFERENCEMENT' $p[0] $p[1]) } else { $sel += "NULL AS [$($p[1])]" }
    }
    if ($okR -and (AC 'REFERENCEMENT' 'PVHT') -and (AC 'REFERENCEMENT' 'PA_NET_MAG')) {
      $sel += 'CASE WHEN r.PVHT > 0 AND r.PA_NET_MAG > 0 THEN CAST(ROUND((r.PVHT - r.PA_NET_MAG) * 100.0 / r.PVHT, 1) AS decimal(9,1)) END AS [TAUX_MARGE_HT]'
    } else { $sel += 'NULL AS [TAUX_MARGE_HT]' }
    # fournisseur (celui du referencement, sinon le principal), reference et colisage
    if ((AC 'REFERFOU' 'ID_ART') -and (AC 'REFERFOU' 'ID_REFFOUR')) {
      $ord = @()
      if ($okR -and (AC 'REFERENCEMENT' 'ID_REFFOUR')) { $ord += 'CASE WHEN f.ID_REFFOUR = r.ID_REFFOUR THEN 0 ELSE 1 END' }
      if (AC 'REFERFOU' 'FLG_PRINCI') { $ord += 'f.FLG_PRINCI DESC' }
      $ob = if ($ord) { 'ORDER BY ' + ($ord -join ', ') } else { '' }
      $from += " OUTER APPLY (SELECT TOP 1 * FROM REFERFOU f WHERE f.ID_ART = a.ID_ART $ob) rf"
      $sel += (K 'rf' 'REFERFOU' 'REFFOUR' 'REF_FOURNISSEUR'), (K 'rf' 'REFERFOU' 'CONDI' 'COLISAGE')
      $tl = PC 'TIERS' @('RAISOC', 'NOM')
      if ((AC 'REFERFOU' 'ID_TIERS') -and (AC 'TIERS' 'ID_TIERS') -and $tl) {
        $from += ' LEFT JOIN TIERS t ON t.ID_TIERS = rf.ID_TIERS'
        $sel += (K 't' 'TIERS' 'CODTIERS' 'CODE_FOURNISSEUR'), "t.[$tl] AS [FOURNISSEUR]"
      } else { $sel += 'NULL AS [CODE_FOURNISSEUR]', 'NULL AS [FOURNISSEUR]' }
      if (AC 'TARIF_FOU' 'ID_REFFOUR') {
        $od = if (AC 'TARIF_FOU' 'DATE_PA') { 'ORDER BY y.DATE_PA DESC' } else { '' }
        $from += " OUTER APPLY (SELECT TOP 1 * FROM TARIF_FOU y WHERE y.ID_REFFOUR = rf.ID_REFFOUR $od) tf"
        $sel += (K 'tf' 'TARIF_FOU' 'PA_NET' 'PA_NET_FOURNISSEUR'), (K 'tf' 'TARIF_FOU' 'PA_BRUT' 'PA_BRUT_FOURNISSEUR'), (K 'tf' 'TARIF_FOU' 'PV' 'PV_CONSEILLE_TTC'), (K 'tf' 'TARIF_FOU' 'DATE_PA' 'DATE_PA')
      } else { $sel += 'NULL AS [PA_NET_FOURNISSEUR]', 'NULL AS [PA_BRUT_FOURNISSEUR]', 'NULL AS [PV_CONSEILLE_TTC]', 'NULL AS [DATE_PA]' }
    } else { $sel += 'NULL AS [REF_FOURNISSEUR]', 'NULL AS [COLISAGE]', 'NULL AS [CODE_FOURNISSEUR]', 'NULL AS [FOURNISSEUR]', 'NULL AS [PA_NET_FOURNISSEUR]', 'NULL AS [PA_BRUT_FOURNISSEUR]', 'NULL AS [PV_CONSEILLE_TTC]', 'NULL AS [DATE_PA]' }
    # stock
    if (AC 'STOCK' 'ID_ART') {
      $from += ' OUTER APPLY (SELECT TOP 1 * FROM STOCK z WHERE z.ID_ART = a.ID_ART) s'
      $sel += (K 's' 'STOCK' 'STK_DISP' 'STOCK'), (K 's' 'STOCK' 'PX_PMP' 'PMP'), (K 's' 'STOCK' 'DERN_PA' 'DERNIER_PA')
    } else { $sel += 'NULL AS [STOCK]', 'NULL AS [PMP]', 'NULL AS [DERNIER_PA]' }
    $ordA = if (AC 'ARTICLE' 'COD_ART') { ' ORDER BY a.COD_ART' } else { '' }
    $nomComplet = "ARTICLES-$magU-complet.csv"
    try {
      $n = Ecrire ('SELECT ' + ($sel -join ', ') + ' ' + $from + $ordA) (Join-Path $dosArt $nomComplet)
      $bilan += "$nomComplet $n articles"
    } catch { Log ('Articles : fichier complet non fait (' + $_.Exception.Message + ')') }

    [IO.File]::WriteAllText($repere, ((Get-Date).ToString('dd/MM/yyyy HH:mm') + "`r`n" + ($bilan -join "`r`n")), $bom)
    Log ('Articles OK en ' + [int]((Get-Date) - $t0).TotalSeconds + ' s : ' + ($bilan -join ', '))
  }
} catch { Log ('Articles : ERREUR ' + $_.Exception.Message) }

if ($echec) { exit 1 }
