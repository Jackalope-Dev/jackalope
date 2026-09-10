param([Parameter(Mandatory)][int]$AppProcessId, [int]$Samples = 10)
$ErrorActionPreference = 'Stop'
if ($Samples -lt 2 -or $Samples -gt 120) { throw 'Choose 2–120 samples.' }
$app = Get-Process -Id $AppProcessId
if ($app.ProcessName -ne 'jackalope-desktop') { throw 'Select the Jackalope process.' }
$timer = [System.Diagnostics.Stopwatch]::StartNew()
$observations = for ($sample = 0; $sample -lt $Samples; $sample++) {
    $all = Get-CimInstance Win32_Process
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    [void]$ids.Add($AppProcessId)
    do {
        $added = $false
        foreach ($process in $all) {
            if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) { $added = $true }
        }
    } while ($added)
    $processes = @(Get-Process -Id @($ids) -ErrorAction SilentlyContinue)
    [pscustomobject]@{
        ElapsedSeconds = [Math]::Round($timer.Elapsed.TotalSeconds, 3)
        ProcessCount = $processes.Count
        WorkingSetBytes = ($processes | Measure-Object WorkingSet64 -Sum).Sum
        PrivateBytes = ($processes | Measure-Object PrivateMemorySize64 -Sum).Sum
        TotalCpuSeconds = ($processes | Measure-Object CPU -Sum).Sum
    }
    Start-Sleep -Seconds 1
}
$observations | ConvertTo-Json
