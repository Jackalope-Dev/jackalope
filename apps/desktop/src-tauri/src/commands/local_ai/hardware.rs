use super::*;

fn output(program: &str, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    process_control::run(command, Duration::from_secs(12))
        .ok()
        .filter(|r| r.success && !r.truncated)
        .map(|r| r.stdout)
}

pub(super) fn inspect() -> Value {
    let mut value = json!({"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"memoryBytes":null,"availableMemoryBytes":null,"freeDiskBytes":null,"gpu":null,"diskLocation":null});
    #[cfg(windows)]
    if let Some(text) = output(
        "powershell.exe",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            r#"$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; $gpu=Get-CimInstance Win32_VideoController; $folder=if($env:OLLAMA_MODELS){$env:OLLAMA_MODELS}else{Join-Path $env:USERPROFILE '.ollama\models'}; $drive=Get-PSDrive -Name ([System.IO.Path]::GetPathRoot($folder).TrimEnd('\').TrimEnd(':')) -ErrorAction SilentlyContinue; @{memoryBytes=[uint64]$os.TotalVisibleMemorySize*1024;availableMemoryBytes=[uint64]$os.FreePhysicalMemory*1024;freeDiskBytes=$drive.Free;gpu=($gpu.Name -join ', ');diskLocation=$folder}|ConvertTo-Json -Compress"#,
        ],
    ) {
        if let Ok(found) = serde_json::from_str::<Value>(&text) {
            for key in [
                "memoryBytes",
                "availableMemoryBytes",
                "freeDiskBytes",
                "gpu",
                "diskLocation",
            ] {
                value[key] = found[key].clone();
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(text) = std::fs::read_to_string("/proc/meminfo") {
            for (field, key) in [
                ("MemTotal:", "memoryBytes"),
                ("MemAvailable:", "availableMemoryBytes"),
            ] {
                value[key] = text
                    .lines()
                    .find(|line| line.starts_with(field))
                    .and_then(|line| line.split_whitespace().nth(1))
                    .and_then(|n| n.parse::<u64>().ok())
                    .map(|n| json!(n * 1024))
                    .unwrap_or(Value::Null);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        value["memoryBytes"] = output("/usr/sbin/sysctl", &["-n", "hw.memsize"])
            .and_then(|n| n.trim().parse::<u64>().ok())
            .map(|n| json!(n))
            .unwrap_or(Value::Null);
    }
    #[cfg(unix)]
    {
        let path = std::env::var("OLLAMA_MODELS").ok().or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|p| format!("{p}/.ollama/models"))
        });
        if let Some(path) = path {
            let mut existing = std::path::Path::new(&path);
            while !existing.exists() {
                if let Some(parent) = existing.parent() {
                    existing = parent;
                } else {
                    break;
                }
            }
            value["freeDiskBytes"] = output("df", &["-Pk", &existing.to_string_lossy()])
                .and_then(|text| {
                    text.lines()
                        .last()
                        .and_then(|line| line.split_whitespace().nth(3))
                        .and_then(|n| n.parse::<u64>().ok())
                })
                .map(|n| json!(n * 1024))
                .unwrap_or(Value::Null);
            value["diskLocation"] = json!(path);
        }
    }
    value
}
