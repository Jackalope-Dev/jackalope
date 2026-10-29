$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$form=New-Object System.Windows.Forms.Form
$form.Text=$env:JACKALOPE_DESKTOP_FIXTURE_TITLE
$form.ClientSize=New-Object System.Drawing.Size(600,300)
$form.StartPosition='CenterScreen'
$form.ShowInTaskbar=$false
# Passive fixtures stay invisible and never take focus, for read-only measurements.
$passive=$env:JACKALOPE_DESKTOP_FIXTURE_PASSIVE -eq '1'
if ($passive) { $form.Opacity=0.01 } else { $form.TopMost=$true }
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
$button=New-Object System.Windows.Forms.Button
$button.Text='Fixture button'
$button.Location=New-Object System.Drawing.Point(24,220)
$button.Size=New-Object System.Drawing.Size(160,36)
$button.Add_Click({[System.IO.File]::WriteAllText($env:JACKALOPE_DESKTOP_FIXTURE_RESULT,'button invoked')})
$form.Controls.AddRange(@($label,$inputBox,$password,$button))
# The fixture closes itself so an interrupted run never leaves a window behind.
$limit=New-Object System.Windows.Forms.Timer
$limit.Interval=120000
$limit.Add_Tick({$form.Close()})
$limit.Start()
if (!$passive) { $form.Add_Shown({$form.Activate();$inputBox.Focus()}) }
[void]$form.ShowDialog()
$form.Dispose()
