$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form=New-Object System.Windows.Forms.Form
$form.Text=$env:JACKALOPE_DESKTOP_FIXTURE_TITLE
$form.ClientSize=New-Object System.Drawing.Size(600,300)
$form.StartPosition='CenterScreen'
$form.TopMost=$true
$label=New-Object System.Windows.Forms.Label
$label.Text='Disposable Jackalope desktop-control acceptance window'
$label.Location=New-Object System.Drawing.Point(24,24)
$label.Size=New-Object System.Drawing.Size(550,35)
$inputBox=New-Object System.Windows.Forms.TextBox
$inputBox.AccessibleName='Trial text'
$inputBox.Location=New-Object System.Drawing.Point(24,85)
$inputBox.Size=New-Object System.Drawing.Size(520,40)
$inputBox.Font=New-Object System.Drawing.Font('Segoe UI',16)
$inputBox.Add_TextChanged({[System.IO.File]::WriteAllText($env:JACKALOPE_DESKTOP_FIXTURE_RESULT,$inputBox.Text)})
$password=New-Object System.Windows.Forms.TextBox
$password.AccessibleName='Protected fixture'
$password.UseSystemPasswordChar=$true
$password.Text='fixture-only-hidden'
$password.Location=New-Object System.Drawing.Point(24,160)
$password.Size=New-Object System.Drawing.Size(520,40)
$form.Controls.AddRange(@($label,$inputBox,$password))
$form.Add_Shown({$form.Activate();$inputBox.Focus()})
[void]$form.ShowDialog()
$form.Dispose()
