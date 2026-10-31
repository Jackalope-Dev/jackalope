$ErrorActionPreference='Stop'
$utf8=New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding=$utf8
[Console]::OutputEncoding=$utf8
$source=$utf8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Drawing,System.Windows.Forms,System.Web.Extensions
$references=@([System.Windows.Automation.AutomationElement],[System.Windows.Automation.ControlType],[System.Windows.Rect],[System.Drawing.Bitmap],[System.Windows.Forms.Screen],[System.Web.Script.Serialization.JavaScriptSerializer],[System.ComponentModel.Component]) | ForEach-Object { $_.Assembly.Location } | Select-Object -Unique
Add-Type -ReferencedAssemblies $references -TypeDefinition $source
[JackalopeDesktop]::Serve()
