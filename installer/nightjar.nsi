; Nightjar for Windows installer (per user, no admin rights).
; Built by installer/build.sh, which fills the "stage" folder first.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP "Nightjar"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Nightjar"

Name "${APP}"
OutFile "out\Nightjar-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Nightjar"
InstallDirRegKey HKCU "Software\Nightjar" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Nightjar ${VERSION} · built on slskd"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Nightjar"
VIAddVersionKey "FileDescription" "Nightjar installer"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "AGPL-3.0. Includes slskd (AGPL-3.0)."

!define MUI_ICON "stage\nightjar.ico"
!define MUI_UNICON "stage\nightjar.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Install Nightjar"
!define MUI_WELCOMEPAGE_TEXT "Nightjar finds music on Soulseek, a network of people sharing their own record collections, and downloads the best copy it can find.$\r$\n$\r$\nYou don't need anything else: no Soulseek account yet, no other programs. Nightjar walks you through the first start.$\r$\n$\r$\nNightjar is not the official Soulseek client."
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open Nightjar"
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

; Closes a running Nightjar (and an older SSK-Lite) so their files can be replaced.
!macro CloseRunning
  ; ask Nightjar to quit cleanly: it stops the engine and saves its state
  nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -Method Post -Uri http://127.0.0.1:5031/quit -Headers @{Origin=''http://127.0.0.1:5030''} -UseBasicParsing -TimeoutSec 3 | Out-Null; Start-Sleep -Seconds 6 } catch { }"'
  Pop $0
  ; the old SSK-Lite launcher (PowerShell, icon next to the clock)
  nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process -Filter \"Name=''powershell.exe''\" | Where-Object { $$_.CommandLine -like ''*SSK-Lite.ps1*'' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }"'
  Pop $0
  nsExec::Exec 'taskkill.exe /IM Nightjar.exe /F'
  Pop $0
  nsExec::Exec 'taskkill.exe /IM slskd.exe /F'
  Pop $0
  Sleep 1000
!macroend

Section "Nightjar" SecApp
  SectionIn RO
  !insertmacro CloseRunning
  SetOutPath "$INSTDIR"
  ; replace the program completely, so no old files stay behind (your data folder stays)
  RMDir /r "$INSTDIR\slskd"
  File /r "stage\*.*"
  CreateDirectory "$INSTDIR\data"

  ; SSK-Lite is now Nightjar: its shortcuts go, so only one of them starts.
  Delete "$SMPROGRAMS\SSK-Lite.lnk"
  Delete "$DESKTOP\SSK-Lite.lnk"
  ${If} ${FileExists} "$SMSTARTUP\SSK-Lite.lnk"
    Delete "$SMSTARTUP\SSK-Lite.lnk"
    CreateShortcut "$SMSTARTUP\Nightjar.lnk" "$INSTDIR\Nightjar.exe" "--background" "$INSTDIR\Nightjar.exe" 0
  ${EndIf}

  CreateDirectory "$SMPROGRAMS"
  CreateShortcut "$SMPROGRAMS\Nightjar.lnk" "$INSTDIR\Nightjar.exe" "" "$INSTDIR\Nightjar.exe" 0

  WriteRegStr HKCU "Software\Nightjar" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "Nightjar"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "lunice"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\Nightjar.exe"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall Nightjar.exe"'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
  WriteUninstaller "$INSTDIR\Uninstall Nightjar.exe"
SectionEnd

Section "Desktop shortcut" SecDesktop
  CreateShortcut "$DESKTOP\Nightjar.lnk" "$INSTDIR\Nightjar.exe" "" "$INSTDIR\Nightjar.exe" 0
SectionEnd

Section /o "Start with Windows" SecStartup
  CreateShortcut "$SMSTARTUP\Nightjar.lnk" "$INSTDIR\Nightjar.exe" "--background" "$INSTDIR\Nightjar.exe" 0
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecApp} "Nightjar and the slskd engine it runs on."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} "A Nightjar icon on the desktop."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStartup} "Starts Nightjar next to the clock when you sign in to Windows, so your shared music stays online."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; "/S /update": an update started by Nightjar itself. It keeps your shortcuts as they are and opens Nightjar again.
Var Updating
Function .onInit
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/update" $R1
  ${IfNot} ${Errors}
    StrCpy $Updating 1
    ${IfNot} ${FileExists} "$DESKTOP\Nightjar.lnk"
      !insertmacro UnselectSection ${SecDesktop}
    ${EndIf}
  ${EndIf}
FunctionEnd

Function .onInstSuccess
  ${If} $Updating == 1
    Exec '"$INSTDIR\Nightjar.exe"'
  ${EndIf}
FunctionEnd

Function RunApp
  Exec '"$INSTDIR\Nightjar.exe"'
FunctionEnd

Section "Uninstall"
  !insertmacro CloseRunning
  Delete "$SMPROGRAMS\Nightjar.lnk"
  Delete "$DESKTOP\Nightjar.lnk"
  Delete "$SMSTARTUP\Nightjar.lnk"
  RMDir /r "$INSTDIR\slskd"
  Delete "$INSTDIR\Nightjar.exe"
  Delete "$INSTDIR\Nightjar.exe.config"
  Delete "$INSTDIR\*.dll"
  RMDir /r "$INSTDIR\runtimes"
  RMDir /r "$INSTDIR\tools"
  Delete "$INSTDIR\nightjar.ico"
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\NOTICE.txt"
  Delete "$INSTDIR\Uninstall Nightjar.exe"
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your Nightjar settings, Soulseek login and history?$\r$\n$\r$\nYour downloaded music is not touched either way." /SD IDNO IDNO keep
    RMDir /r "$INSTDIR\data"
  keep:
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\Nightjar"
SectionEnd
