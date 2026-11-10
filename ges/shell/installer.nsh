; GES - réglages de l'installateur (NSIS)
; GES réunit GESMAR, GESTIME, GESTAT et GESCOUNT. Toutes les données sont dans %APPDATA%\GES (un sous-dossier par logiciel),
; recopiées au 1er lancement depuis les anciens dossiers %APPDATA%\GESMAR… Rien n'est effacé (ni à l'installation, ni à la désinstallation).

!macro customHeader
  ShowInstDetails show
!macroend

!macro customInit
  ; Les anciens programmes séparés doivent être fermés (ils partagent les mêmes données que GES).
  nsExec::Exec 'taskkill /F /IM GESMAR.exe'
  nsExec::Exec 'taskkill /F /IM GESTIME.exe'
  nsExec::Exec 'taskkill /F /IM GESTAT.exe'
  nsExec::Exec 'taskkill /F /IM GESCOUNT.exe'
!macroend

!macro customInstall
  DetailPrint "Vos données seront dans $APPDATA\GES (recopiées au premier lancement depuis les anciens programmes)."
  ; GESCOUNT ne démarre plus seul avec Windows : c'est GES qui démarre (avec les 4 logiciels).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "fr.fabz91.gescount"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.GESCOUNT"
  ; Anciens raccourcis du bureau (remplacés par GES)
  Delete "$DESKTOP\GESMAR.lnk"
  Delete "$DESKTOP\GESTIME.lnk"
  Delete "$DESKTOP\GESTAT.lnk"
  Delete "$DESKTOP\GESCOUNT.lnk"
  Delete "$DESKTOP\GESTAT ( BETA ).lnk"
  ; Raccourcis GES
  CreateShortCut "$DESKTOP\GES.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\ges-icone.ico" 0
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\GES.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\ges-icone.ico" 0
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "fr.fabz91.ges"
  DetailPrint "Les données de $APPDATA\GES sont conservées."
!macroend
