; GESMAR - réglages de l'installateur (NSIS)
; Les données sont dans %APPDATA%\GESMAR\donnees : elles ne sont jamais effacées,
; ni par une réinstallation par-dessus, ni par la désinstallation.

!macro customHeader
  ShowInstDetails show
!macroend

!macro customInstall
  DetailPrint "Vos données GESMAR restent dans $APPDATA\GESMAR\donnees"
  ; Raccourcis avec l'icône GESMAR (l'exe lui-même garde l'icône par défaut, comme GESTIME)
  CreateShortCut "$DESKTOP\GESMAR.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\gesmar-icone.ico" 0
  CreateDirectory "$SMPROGRAMS"
  CreateShortCut "$SMPROGRAMS\GESMAR.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\resources\gesmar-icone.ico" 0
!macroend

!macro customUnInstall
  DetailPrint "Les données de $APPDATA\GESMAR\donnees sont conservées."
!macroend
