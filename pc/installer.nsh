; GESMAR - réglages de l'installateur (NSIS)
; Les données sont dans %APPDATA%\GESMAR\donnees : elles ne sont jamais effacées,
; ni par une réinstallation par-dessus, ni par la désinstallation.

!macro customHeader
  ShowInstDetails show
!macroend

!macro customInstall
  DetailPrint "Vos données GESMAR restent dans $APPDATA\GESMAR\donnees"
!macroend

!macro customUnInstall
  DetailPrint "Les données de $APPDATA\GESMAR\donnees sont conservées."
!macroend
