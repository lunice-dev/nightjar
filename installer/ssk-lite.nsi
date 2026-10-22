; SSK-Lite for Windows installer (per user, no admin rights).
; Built by installer/build.sh, which fills the "stage" folder first.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP "SSK-Lite"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SSK-Lite"
!define OLD_LIVE "$PROFILE\Downloads\ssk-lite-0.1\SSK-Lite Live"

Name "${APP}"
OutFile "out\SSK-Lite-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\SSK-Lite"
InstallDirRegKey HKCU "Software\SSK-Lite" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "SSK-Lite ${VERSION} · built on slskd"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "SSK-Lite"
VIAddVersionKey "FileDescription" "SSK-Lite installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AGPL-3.0. Includes slskd (AGPL-3.0)."

!define MUI_ICON "stage\ssk-lite.ico"
!define MUI_UNICON "stage\ssk-lite.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install SSK-Lite"
!define MUI_WELCOMEPAGE_TEXT "SSK-Lite is a modern client for the Soulseek network. It runs slskd, an open source Soulseek engine, on this computer and shows it in its own window.$\r$\n$\r$\nSSK-Lite is not the official Soulseek client.$\r$\n$\r$\nClose SoulseekQt before you start SSK-Lite: Soulseek allows one connection per account."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open SSK-Lite"
!define MUI_FINISHPAGE_RUN_FUNCTION RunApp
!define MUI_COMPONENTSPAGE_SMALLDESC

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "stage\LICENSE.txt"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

; Stops a running SSK-Lite engine, so its files can be replaced.
!macro StopEngine
  nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Method Delete -Uri http://127.0.0.1:5030/api/v0/application -UseBasicParsing -TimeoutSec 3 | Out-Null; Start-Sleep -Seconds 4 } catch { }"'
  Pop $0
  ; with phone access on, the request above needs a login: make sure the engine is closed anyway
  nsExec::Exec 'taskkill.exe /IM slskd.exe /F'
  Pop $0
!macroend

Section "SSK-Lite" SecApp
  SectionIn RO
  !insertmacro StopEngine
  SetOutPath "$INSTDIR"
  ; replace the interface completely, so no old files stay behind
  RMDir /r "$INSTDIR\slskd\ssk-lite-web"
  File /r "stage\*.*"
  CreateDirectory "$INSTDIR\data"

  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\SSK-Lite.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\SSK-Lite.vbs"' "$INSTDIR\ssk-lite.ico" 0

  WriteRegStr HKCU "Software\SSK-Lite" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "SSK-Lite"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "SSK-Lite"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\ssk-lite.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall SSK-Lite.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
  WriteUninstaller "$INSTDIR\Uninstall SSK-Lite.exe"
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\SSK-Lite.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\SSK-Lite.vbs"' "$INSTDIR\ssk-lite.ico" 0
SectionEnd

Section /o "Start with Windows" SecStartup
  CreateShortcut "$SMSTARTUP\SSK-Lite.lnk" "$SYSDIR\wscript.exe" '"$INSTDIR\SSK-Lite.vbs" background' "$INSTDIR\ssk-lite.ico" 0
SectionEnd

Section "Bring settings from the SSK-Lite test" SecImport
  ; Your Soulseek account, shares, speed settings, wishlist and history from the
  ; "SSK-Lite Live" folder. Only when this install has no settings yet.
  ${If} ${FileExists} "${OLD_LIVE}\data\slskd.yml"
  ${AndIfNot} ${FileExists} "$INSTDIR\data\slskd.yml"
    CopyFiles /SILENT "${OLD_LIVE}\data\slskd.yml" "$INSTDIR\data"
    ${If} ${FileExists} "${OLD_LIVE}\data\ssk-lite-prefs.json"
      CopyFiles /SILENT "${OLD_LIVE}\data\ssk-lite-prefs.json" "$INSTDIR\data"
    ${EndIf}
    ${If} ${FileExists} "${OLD_LIVE}\data\data\*.*"
      CreateDirectory "$INSTDIR\data\data"
      CopyFiles /SILENT "${OLD_LIVE}\data\data\*.*" "$INSTDIR\data\data"
    ${EndIf}
    DetailPrint "Brought over your settings from SSK-Lite Live."
  ${EndIf}
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "SSK-Lite and the slskd engine it runs on."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "An SSK-Lite icon on the desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Starts SSK-Lite in the background when you sign in to Windows, so your shared music stays online."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecImport} "Your Soulseek account, shared folders, wishlist and history from the SSK-Lite Live test folder, if you used it."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Function .onInit
  ${IfNot} ${FileExists} "${OLD_LIVE}\data\slskd.yml"
    SectionSetFlags ${SecImport} 0
    SectionSetText ${SecImport} ""
  ${EndIf}
FunctionEnd

Function RunApp
  Exec '"$SYSDIR\wscript.exe" "$INSTDIR\SSK-Lite.vbs"'
FunctionEnd

Section "Uninstall"
  !insertmacro StopEngine
  Delete "$SMPROGRAMS\SSK-Lite.lnk"
  Delete "$DESKTOP\SSK-Lite.lnk"
  Delete "$SMSTARTUP\SSK-Lite.lnk"
  RMDir /r "$INSTDIR\slskd"
  Delete "$INSTDIR\SSK-Lite.ps1"
  Delete "$INSTDIR\SSK-Lite.vbs"
  Delete "$INSTDIR\helper.ps1"
  Delete "$INSTDIR\upnp.ps1"
  Delete "$INSTDIR\firewall.ps1"
  Delete "$INSTDIR\ssk-lite.ico"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\NOTICE.txt"
  Delete "$INSTDIR\Uninstall SSK-Lite.exe"
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your SSK-Lite settings, Soulseek login and history?$\r$\n$\r$\nYour downloaded music is not touched either way." IDNO keep
    RMDir /r "$INSTDIR\data"
  keep:
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\SSK-Lite"
SectionEnd
