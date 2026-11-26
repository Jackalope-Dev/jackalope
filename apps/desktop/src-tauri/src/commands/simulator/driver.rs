//! The bundled XCUITest driver: built once per Xcode and driver source, run
//! per device as an owned `xcodebuild test-without-building` process tree, and
//! called over loopback HTTP with a per-launch bearer token.

use super::super::{process_control, resources, xcode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Stdio},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};

/// The protocol version the driver reports in `/health`.
const PROTOCOL: u64 = 1;
const SOURCE: &str = "resources/simulator-driver";
/// The UI-test runner app `xcodebuild` installs on the device.
const RUNNER: &str = "digital.jackalope.SimulatorDriver.xctrunner";
/// A cold start installs and launches the runner, about 40 seconds.
const READY_WITHIN: Duration = Duration::from_secs(180);
const BUILD_LIMIT: Duration = Duration::from_secs(15 * 60);
const BUILD_STALL: Duration = Duration::from_secs(5 * 60);
/// The largest driver response read.
const RESPONSE_LIMIT: usize = 8 << 20;

/// A running driver on one device.
pub(super) struct Driver {
    pub udid: String,
    port: u16,
    token: String,
    child: Mutex<Child>,
    tree: process_control::ProcessTree,
    /// The run's log and result bundle, removed when it stops.
    files: Vec<PathBuf>,
    /// Calls run one at a time.
    calls: Mutex<()>,
}

fn drivers() -> std::sync::MutexGuard<'static, HashMap<String, Arc<Driver>>> {
    static DRIVERS: OnceLock<Mutex<HashMap<String, Arc<Driver>>>> = OnceLock::new();
    DRIVERS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
}

/// One lock per device, so a device starts one driver at a time while other
/// devices start theirs.
fn start_lock(udid: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
        .entry(udid.to_string())
        .or_default()
        .clone()
}

/// Progress lines and cancellation from the attempt that needs the driver.
pub(super) struct Context<'a> {
    pub root: &'a Path,
    pub progress: &'a (dyn Fn(&str) + Sync),
    pub canceled: &'a (dyn Fn() -> bool + Sync),
}

/// The device's running driver, building and starting it when needed.
pub(super) fn for_device(udid: &str, context: &Context) -> Result<Arc<Driver>, String> {
    if let Some(driver) = running(udid) {
        return Ok(driver);
    }
    let lock = start_lock(udid);
    let _starting = lock.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some(driver) = running(udid) {
        return Ok(driver);
    }
    let products = build(context)?;
    let driver = Arc::new(start(udid, &products, context)?);
    drivers().insert(udid.to_string(), driver.clone());
    Ok(driver)
}

/// A live driver for the device; a dead one is cleaned up.
fn running(udid: &str) -> Option<Arc<Driver>> {
    let driver = drivers().get(udid).cloned()?;
    if driver.alive() {
        return Some(driver);
    }
    drivers().remove(udid);
    driver.shut();
    None
}

pub(super) fn stop(udid: &str) {
    let driver = drivers().remove(udid);
    if let Some(driver) = driver {
        driver.shut();
    }
}

pub(super) fn stop_all() {
    let all: Vec<Arc<Driver>> = drivers().drain().map(|(_, driver)| driver).collect();
    let stopping: Vec<_> = all
        .into_iter()
        .map(|driver| std::thread::spawn(move || driver.shut()))
        .collect();
    for handle in stopping {
        let _ = handle.join();
    }
}

impl Driver {
    fn alive(&self) -> bool {
        self.child
            .lock()
            .map(|mut child| matches!(child.try_wait(), Ok(None)))
            .unwrap_or(false)
    }

    /// Calls the driver. `path` is one of its routes; errors carry the
    /// driver's own message.
    pub fn call(&self, path: &str, body: &Value, timeout: Duration) -> Result<Value, String> {
        let _turn = self
            .calls
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        let result = request(self.port, &self.token, "POST", path, Some(body), timeout);
        if result.is_err() && !self.alive() {
            return Err("The simulator driver stopped. Call the tool again to restart it.".into());
        }
        result
    }

    /// Asks the driver to finish, then ends its process tree and the runner
    /// app, and removes its files.
    fn shut(&self) {
        let _ = request(
            self.port,
            &self.token,
            "POST",
            "/stop",
            Some(&json!({})),
            Duration::from_secs(2),
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        while self.alive() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(100));
        }
        self.tree.terminate();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = super::simctl::run(
            &super::simctl::terminate(&self.udid, RUNNER),
            Duration::from_secs(10),
        );
        for file in &self.files {
            let _ = std::fs::remove_dir_all(file).or_else(|_| std::fs::remove_file(file));
        }
    }
}

/// The built driver's `.xctestrun` file, building it for this Xcode and
/// driver source the first time.
fn build(context: &Context) -> Result<PathBuf, String> {
    static BUILDING: Mutex<()> = Mutex::new(());
    let toolchain = xcode::toolchain().ok_or("The iOS Simulator tools need Xcode.")?;
    let source = resources::bundled(SOURCE)
        .ok_or("The simulator driver is missing from this build of Jackalope.")?;
    let key = format!(
        "{}-{}",
        toolchain
            .build
            .clone()
            .or(toolchain.version.clone())
            .unwrap_or_else(|| "xcode".into()),
        source_hash(&source)?
    );
    let directory = context.root.join(&key);
    let marker = directory.join("xctestrun");
    let built = || {
        std::fs::read_to_string(&marker)
            .ok()
            .map(PathBuf::from)
            .filter(|path| path.is_file())
    };
    if let Some(products) = built() {
        return Ok(products);
    }
    let _building = BUILDING.lock().unwrap_or_else(|poison| poison.into_inner());
    if let Some(products) = built() {
        return Ok(products);
    }
    (context.progress)(&format!(
        "Building the simulator driver for Xcode {} (first use takes about a minute)",
        toolchain.version.as_deref().unwrap_or("")
    ));
    let _ = std::fs::remove_dir_all(&directory);
    let copy = directory.join("source");
    copy_tree(&source, &copy)?;
    let derived = directory.join("derived");
    let mut command = xcode::xcrun("xcodebuild");
    command.args(build_args(&copy, &derived));
    let started = Instant::now();
    let result = process_control::run_supervised(
        command,
        process_control::Limits::supervised(BUILD_LIMIT, BUILD_STALL),
        || (context.canceled)(),
        |_, _| {},
    )?;
    if !result.success {
        let _ = std::fs::remove_dir_all(&directory);
        if (context.canceled)() {
            return Err("The attempt stopped while the simulator driver was building.".into());
        }
        let output = format!("{}\n{}", result.stdout, result.stderr);
        return Err(format!(
            "The simulator driver did not build{}:\n{}",
            result
                .interruption()
                .map(|why| format!(" (it {why})"))
                .unwrap_or_default(),
            failure_tail(&output)
        ));
    }
    let products = std::fs::read_dir(derived.join("Build/Products"))
        .map_err(|error| error.to_string())?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "xctestrun"))
        .ok_or("The simulator driver built without a test run file.")?;
    std::fs::write(&marker, products.to_string_lossy().as_bytes())
        .map_err(|error| error.to_string())?;
    (context.progress)(&format!(
        "Built the simulator driver in {}s",
        started.elapsed().as_secs()
    ));
    // Builds for an earlier Xcode or driver are not used again.
    if drivers().is_empty() {
        if let Ok(entries) = std::fs::read_dir(context.root) {
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy() != key {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    Ok(products)
}

pub(super) fn build_args(project: &Path, derived: &Path) -> Vec<String> {
    let arch = if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x86_64"
    };
    vec![
        "build-for-testing".into(),
        "-project".into(),
        project
            .join("JackalopeSimulatorDriver.xcodeproj")
            .to_string_lossy()
            .into_owned(),
        "-scheme".into(),
        "Driver".into(),
        "-destination".into(),
        "generic/platform=iOS Simulator".into(),
        "-derivedDataPath".into(),
        derived.to_string_lossy().into_owned(),
        format!("ARCHS={arch}"),
        "ONLY_ACTIVE_ARCH=NO".into(),
        "CODE_SIGNING_ALLOWED=NO".into(),
    ]
}

pub(super) fn run_args(products: &Path, udid: &str, results: &Path) -> Vec<String> {
    vec![
        "test-without-building".into(),
        "-xctestrun".into(),
        products.to_string_lossy().into_owned(),
        "-destination".into(),
        format!("id={udid}"),
        "-resultBundlePath".into(),
        results.to_string_lossy().into_owned(),
    ]
}

/// Starts the driver on `udid` and waits until it answers.
fn start(udid: &str, products: &Path, context: &Context) -> Result<Driver, String> {
    (context.progress)(
        "Starting the simulator driver (about 40 seconds the first time on a device)",
    );
    let runs = context.root.join("runs");
    std::fs::create_dir_all(&runs).map_err(|error| error.to_string())?;
    let id = uuid::Uuid::new_v4().simple().to_string();
    let log = runs.join(format!("{id}.log"));
    let results = runs.join(format!("{id}.xcresult"));
    let port = free_port()?;
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let output = std::fs::File::create(&log).map_err(|error| error.to_string())?;
    let errors = output.try_clone().map_err(|error| error.to_string())?;
    let mut command = xcode::xcrun("xcodebuild");
    command
        .args(run_args(products, udid, &results))
        .env("TEST_RUNNER_JACKALOPE_DRIVER_PORT", port.to_string())
        .env("TEST_RUNNER_JACKALOPE_DRIVER_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(output)
        .stderr(errors);
    process_control::isolated(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start xcodebuild: {error}"))?;
    let tree = match process_control::ProcessTree::attach(&child) {
        Ok(tree) => tree,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };
    let driver = Driver {
        udid: udid.to_string(),
        port,
        token,
        child: Mutex::new(child),
        tree,
        files: vec![log.clone(), results],
        calls: Mutex::new(()),
    };
    let started = Instant::now();
    loop {
        if !driver.alive() {
            let text = std::fs::read_to_string(&log).unwrap_or_default();
            driver.shut();
            return Err(format!(
                "The simulator driver exited before it was ready:\n{}",
                failure_tail(&text)
            ));
        }
        if (context.canceled)() {
            driver.shut();
            return Err("The attempt stopped while the simulator driver was starting.".into());
        }
        if let Ok(health) = request(
            port,
            &driver.token,
            "GET",
            "/health",
            None,
            Duration::from_secs(2),
        ) {
            if health["version"].as_u64() != Some(PROTOCOL) {
                driver.shut();
                return Err("The simulator driver speaks another protocol version.".into());
            }
            (context.progress)(&format!(
                "Simulator driver ready in {}s",
                started.elapsed().as_secs()
            ));
            return Ok(driver);
        }
        if started.elapsed() > READY_WITHIN {
            let text = std::fs::read_to_string(&log).unwrap_or_default();
            driver.shut();
            return Err(format!(
                "The simulator driver did not answer within {}s:\n{}",
                READY_WITHIN.as_secs(),
                failure_tail(&text)
            ));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
}

fn free_port() -> Result<u16, String> {
    TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("No free local port for the simulator driver: {error}"))
}

/// One HTTP/1.1 request to the driver on 127.0.0.1.
fn request(
    port: u16,
    token: &str,
    method: &str,
    path: &str,
    body: Option<&Value>,
    timeout: Duration,
) -> Result<Value, String> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|error| format!("The simulator driver is not reachable: {error}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .and_then(|_| stream.set_write_timeout(Some(Duration::from_secs(10))))
        .map_err(|error| error.to_string())?;
    let payload = body.map(Value::to_string).unwrap_or_default();
    let head = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(payload.as_bytes()))
        .map_err(|error| format!("Could not send to the simulator driver: {error}"))?;
    let mut response = Vec::new();
    stream
        .take(RESPONSE_LIMIT as u64 + 1)
        .read_to_end(&mut response)
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => format!(
                "The simulator driver did not answer within {}s.",
                timeout.as_secs()
            ),
            _ => format!("The simulator driver connection failed: {error}"),
        })?;
    if response.len() > RESPONSE_LIMIT {
        return Err("The simulator driver's answer is too large.".into());
    }
    let (status, value) = parse_response(&response)?;
    if status == 200 {
        Ok(value)
    } else {
        Err(value["error"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| format!("The simulator driver answered HTTP {status}.")))
    }
}

pub(super) fn parse_response(response: &[u8]) -> Result<(u16, Value), String> {
    let split = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("The simulator driver sent an incomplete answer.")?;
    let head = String::from_utf8_lossy(&response[..split]);
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or("The simulator driver sent an invalid status line.")?;
    let value = serde_json::from_slice(&response[split + 4..])
        .map_err(|_| format!("The simulator driver sent invalid JSON with HTTP {status}."))?;
    Ok((status, value))
}

/// The lines of `xcodebuild` output worth showing: its error lines, or else
/// the last lines.
pub(crate) fn failure_tail(output: &str) -> String {
    let errors: Vec<&str> = output
        .lines()
        .map(str::trim)
        .filter(|line| {
            line.contains("error:")
                || line.starts_with("Testing failed")
                || line.contains("** BUILD FAILED **")
                || line.contains("** TEST EXECUTE FAILED **")
        })
        .collect();
    let mut errors = errors;
    errors.dedup();
    let lines: Vec<&str> = if errors.is_empty() {
        let all: Vec<&str> = output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect();
        all[all.len().saturating_sub(15)..].to_vec()
    } else {
        errors[errors.len().saturating_sub(20)..].to_vec()
    };
    tail(&lines.join("\n"), 4_000)
}

/// The end of `text`, at most `limit` characters.
pub(crate) fn tail(text: &str, limit: usize) -> String {
    let count = text.chars().count();
    if count <= limit {
        return text.to_string();
    }
    let kept: String = text.chars().skip(count - limit).collect();
    format!("…{kept}")
}

/// A short hash of the driver source, so a changed driver rebuilds.
fn source_hash(root: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    collect(root, root, &mut files)?;
    files.sort();
    let mut hasher = Sha256::new();
    for relative in files {
        let bytes = std::fs::read(root.join(&relative)).map_err(|error| error.to_string())?;
        hasher.update(relative.as_bytes());
        hasher.update([0]);
        hasher.update(&bytes);
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    Ok(digest[..6]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn skipped(name: &str) -> bool {
    name == ".DS_Store" || name == "xcuserdata"
}

fn collect(root: &Path, folder: &Path, files: &mut Vec<String>) -> Result<(), String> {
    for entry in std::fs::read_dir(folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        if skipped(&name) {
            continue;
        }
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            collect(root, &path, files)?;
        } else if let Ok(relative) = path.strip_prefix(root) {
            files.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    Ok(())
}

fn copy_tree(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|error| error.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if skipped(&name.to_string_lossy()) {
            continue;
        }
        let target = to.join(&name);
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            copy_tree(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
