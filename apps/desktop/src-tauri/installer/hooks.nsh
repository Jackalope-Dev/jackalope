!include "${__FILEDIR__}\theme.nsh"

SetFont "Segoe UI" 9
!define MUI_BGCOLOR "${JACKALOPE_SURFACE}"
!define MUI_TEXTCOLOR "${JACKALOPE_TEXT}"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_INSTFILESPAGE_COLORS "${JACKALOPE_TEXT} ${JACKALOPE_SURFACE}"
!define MUI_WELCOMEPAGE_TITLE "Welcome to Jackalope."
!define MUI_WELCOMEPAGE_TEXT "Your projects, agents and work in one focused place.$\r$\n$\r$\nSet up Jackalope on this computer, then open a project to get started.$\r$\n$\r$\nChoose Next to continue."
!define MUI_FINISHPAGE_TITLE "You're ready to get started."
!define MUI_FINISHPAGE_TEXT "Jackalope is installed.$\r$\n$\r$\nOpen a project, choose an agent and give your next idea a place to grow."

; Keeps the install folder, which holds jackalope.exe, on the user's PATH so a
; new terminal can run `jackalope`. The registry value is edited directly rather
; than through [Environment]::SetEnvironmentVariable, which would rewrite an
; expandable Path as a plain string and break entries such as %USERPROFILE%\bin.
; The folder reaches PowerShell through the environment, not the command line,
; so an apostrophe or other punctuation in it cannot alter the script.
!macro JACKALOPE_UPDATE_USER_PATH ACTION
  System::Call 'Kernel32::SetEnvironmentVariable(t "JACKALOPE_INSTALL_DIR", t "$INSTDIR")i'
  System::Call 'Kernel32::SetEnvironmentVariable(t "JACKALOPE_PATH_ACTION", t "${ACTION}")i'
  nsExec::Exec `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$d=$$env:JACKALOPE_INSTALL_DIR.TrimEnd('\'); $$k=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment',$$true); $$p=[string]$$k.GetValue('Path','','DoNotExpandEnvironmentNames'); $$kind=if($$k.GetValueNames() -contains 'Path'){$$k.GetValueKind('Path')}else{'ExpandString'}; $$parts=@($$p -split ';' | Where-Object { $$_ -and $$_.TrimEnd('\') -ne $$d }); if($$env:JACKALOPE_PATH_ACTION -eq 'add'){ $$parts+=$$d }; $$k.SetValue('Path',($$parts -join ';'),$$kind)"`
  Pop $0
  ; Tell running programs, such as Explorer, to reload the environment.
  SendMessage 0xFFFF 0x001A 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro JACKALOPE_UPDATE_USER_PATH add
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro JACKALOPE_UPDATE_USER_PATH remove
!macroend
