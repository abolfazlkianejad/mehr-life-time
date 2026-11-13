; Deleting app data on uninstall stays opt-in (unchecked box), but the same uninstaller
; also runs inside a GUI update, so a ticked box is confirmed once more, defaulting to No.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "گزینهٔ حذف داده‌های برنامه انتخاب شده است. همهٔ یادداشت‌ها، تسک‌ها و اطلاعات Mehr Life OS در این حساب کاربری ویندوز برای همیشه پاک می‌شوند و قابل بازگشت نیستند. اگر در حال به‌روزرسانی برنامه هستید یا نسخهٔ پشتیبان ندارید، No را بزنید.$\r$\n$\r$\nYou chose to delete the application data. All Mehr Life OS notes, tasks and records of this Windows user will be permanently erased. If you are updating the app or have no backup, choose No.$\r$\n$\r$\nDelete all data permanently?" /SD IDNO IDYES mehr_delete_data_confirmed
    StrCpy $DeleteAppDataCheckboxState 0
    mehr_delete_data_confirmed:
  ${EndIf}
!macroend
