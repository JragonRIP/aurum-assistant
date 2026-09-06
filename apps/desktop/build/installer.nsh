; Safe shortcut migration: remove pre-rebrand "Aurum" Start Menu / Desktop links.
; Does not delete app data or unrelated files.
!macro customInstall
  Delete "$SMPROGRAMS\Aurum.lnk"
  Delete "$DESKTOP\Aurum.lnk"
!macroend
