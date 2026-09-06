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
