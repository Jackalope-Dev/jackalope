fn main() {
    let root = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let package = root.join("../../../node_modules/agent-browser");
    let metadata = std::fs::read_to_string(package.join("package.json"))
        .expect("Run pnpm install --frozen-lockfile before building Jackalope");
    assert!(
        metadata.contains("\"version\": \"0.37.1\""),
        "Unexpected agent-browser version"
    );
    let target = std::env::var("TARGET").unwrap();
    let platform = if target.contains("windows") {
        "win32"
    } else if target.contains("apple") {
        "darwin"
    } else if target.contains("linux") && target.contains("musl") {
        "linux-musl"
    } else if target.contains("linux") {
        "linux"
    } else {
        panic!("agent-browser does not support target {target}")
    };
    assert!(
        target.starts_with("aarch64") || target.starts_with("x86_64"),
        "Unsupported browser architecture: {target}"
    );
    let arch = if target.starts_with("aarch64") && platform != "win32" {
        "arm64"
    } else {
        "x64"
    };
    let suffix = if platform == "win32" { ".exe" } else { "" };
    let name = format!("agent-browser-{platform}-{arch}{suffix}");
    let destination = root.join("resources/agent-browser");
    std::fs::create_dir_all(&destination).unwrap();
    let source = package.join("bin").join(&name);
    println!("cargo:rerun-if-changed={}", source.display());
    println!(
        "cargo:rerun-if-changed={}",
        package.join("package.json").display()
    );
    let staged = destination.join(format!("agent-browser{suffix}"));
    let bytes = std::fs::read(&source).unwrap();
    if std::fs::read(&staged).ok().as_deref() != Some(bytes.as_slice()) {
        std::fs::write(&staged, bytes).unwrap();
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(staged, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    if target.contains("apple") {
        let source = root.join("src/commands/desktop_control/macos.swift");
        println!("cargo:rerun-if-changed={}", source.display());
        let output = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("jackalope-desktop-control");
        let swift_target = if target.starts_with("aarch64") {
            "arm64-apple-macos11.0"
        } else {
            "x86_64-apple-macos11.0"
        };
        let status = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-target",
                swift_target,
            ])
            .arg(&source)
            .arg("-o")
            .arg(&output)
            .status()
            .expect("Building macOS desktop control requires Xcode command-line tools");
        assert!(status.success(), "macOS desktop helper compilation failed");
        let destination = root.join("resources/desktop-control/jackalope-desktop-control");
        let bytes = std::fs::read(&output).unwrap();
        if std::fs::read(&destination).ok().as_deref() != Some(bytes.as_slice()) {
            std::fs::write(&destination, bytes).unwrap();
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(destination, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
    tauri_build::build()
}
