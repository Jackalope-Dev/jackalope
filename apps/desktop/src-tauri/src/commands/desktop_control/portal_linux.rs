//! D-Bus client for the XDG portal backend. RemoteDesktop carries keyboard
//! and pointer input, ScreenCast shares monitors for absolute pointer input,
//! Screenshot takes still captures, and AT-SPI2 reads and operates
//! accessibility trees. It answers the same JSON requests as the native
//! helpers, in process.

use super::grant::Scope;
use super::portal::{self, Shared, Step, Stream};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    future::Future,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use zbus::{
    zvariant::{self, DeserializeDict, OwnedObjectPath, OwnedValue, Type},
    Connection, MatchRule, MessageStream,
};

const PORTAL: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const REMOTE: &str = "org.freedesktop.portal.RemoteDesktop";
const SCREENCAST: &str = "org.freedesktop.portal.ScreenCast";
const SCREENSHOT: &str = "org.freedesktop.portal.Screenshot";
const PROPERTIES: &str = "org.freedesktop.DBus.Properties";
const ACCESSIBLE: &str = "org.a11y.atspi.Accessible";
const TEXT: &str = "org.a11y.atspi.Text";
const EDITABLE: &str = "org.a11y.atspi.EditableText";
const ACTION: &str = "org.a11y.atspi.Action";
const COMPONENT: &str = "org.a11y.atspi.Component";
const VALUE: &str = "org.a11y.atspi.Value";
const SELECTION: &str = "org.a11y.atspi.Selection";
const DOCUMENT: &str = "org.a11y.atspi.Document";
const BTN_LEFT: i32 = 0x110;
const BTN_RIGHT: i32 = 0x111;
/// The system dialog may wait on the user this long before access fails.
const DIALOG_LIMIT: Duration = Duration::from_secs(300);

fn runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    static RUNTIME: OnceLock<Result<tokio::runtime::Runtime, String>> = OnceLock::new();
    RUNTIME
        .get_or_init(|| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(1)
                .thread_name("jackalope-portal")
                .enable_all()
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(|e| format!("The desktop portal client could not start: {e}"))
}

/// Runs a future on the portal runtime from any thread, including threads
/// already inside another async runtime.
fn run<F>(future: F) -> Result<F::Output, String>
where
    F: Future + Send,
    F::Output: Send,
{
    let runtime = runtime()?;
    std::thread::scope(|scope| scope.spawn(|| runtime.block_on(future)).join())
        .map_err(|_| "The desktop portal client stopped unexpectedly.".to_string())
}

fn dbus(error: impl std::fmt::Display) -> String {
    format!("Desktop service error: {error}")
}

async fn call<B>(
    conn: &Connection,
    destination: &str,
    path: &str,
    interface: &str,
    method: &str,
    body: &B,
) -> Result<zbus::Message, String>
where
    B: serde::Serialize + zvariant::DynamicType,
{
    conn.call_method(Some(destination), path, Some(interface), method, body)
        .await
        .map_err(dbus)
}

async fn property(
    conn: &Connection,
    destination: &str,
    path: &str,
    interface: &str,
    name: &str,
) -> Result<OwnedValue, String> {
    call(
        conn,
        destination,
        path,
        PROPERTIES,
        "Get",
        &(interface, name),
    )
    .await?
    .body()
    .deserialize::<OwnedValue>()
    .map_err(dbus)
}

async fn portal_u32(conn: &Connection, interface: &str, name: &str) -> u32 {
    match property(conn, PORTAL, PORTAL_PATH, interface, name).await {
        Ok(value) => u32::try_from(value).unwrap_or(0),
        Err(_) => 0,
    }
}

async fn accessibility_bus(session: &Connection) -> Result<Connection, String> {
    let address: String = call(
        session,
        "org.a11y.Bus",
        "/org/a11y/bus",
        "org.a11y.Bus",
        "GetAddress",
        &(),
    )
    .await?
    .body()
    .deserialize()
    .map_err(dbus)?;
    zbus::connection::Builder::address(address.as_str())
        .map_err(dbus)?
        .build()
        .await
        .map_err(dbus)
}

/// Reads what the session's portal and accessibility buses offer.
pub(crate) fn probe() -> Option<portal::PortalInfo> {
    run(async {
        tokio::time::timeout(Duration::from_secs(4), async {
            let conn = Connection::session().await.ok()?;
            let remote_desktop = portal_u32(&conn, REMOTE, "version").await;
            let screencast = portal_u32(&conn, SCREENCAST, "version").await;
            Some(portal::PortalInfo {
                remote_desktop,
                device_types: if remote_desktop > 0 {
                    portal_u32(&conn, REMOTE, "AvailableDeviceTypes").await
                } else {
                    0
                },
                screencast,
                source_types: if screencast > 0 {
                    portal_u32(&conn, SCREENCAST, "AvailableSourceTypes").await
                } else {
                    0
                },
                screenshot: portal_u32(&conn, SCREENSHOT, "version").await,
                accessibility: accessibility_bus(&conn).await.is_ok(),
            })
        })
        .await
        .ok()
        .flatten()
    })
    .ok()
    .flatten()
}

// ---- portal session ----

#[derive(DeserializeDict, Type, Default)]
#[zvariant(signature = "dict")]
struct StreamProperties {
    position: Option<(i32, i32)>,
    size: Option<(i32, i32)>,
}

#[derive(DeserializeDict, Type, Default)]
#[zvariant(signature = "dict")]
struct StartResults {
    streams: Option<Vec<(u32, StreamProperties)>>,
    restore_token: Option<String>,
}

struct Live {
    connection: Connection,
    session: OwnedObjectPath,
    streams: Vec<Stream>,
    closed: tokio::task::JoinHandle<()>,
}

fn token() -> String {
    format!("jackalope{}", uuid::Uuid::new_v4().simple())
}

async fn subscribe(
    conn: &Connection,
    interface: &str,
    member: &str,
    path: &str,
) -> Result<MessageStream, String> {
    let rule = MatchRule::builder()
        .msg_type(zbus::message::Type::Signal)
        .interface(interface)
        .map_err(dbus)?
        .member(member)
        .map_err(dbus)?
        .path(path)
        .map_err(dbus)?
        .build();
    MessageStream::for_match_rule(rule, conn, Some(4))
        .await
        .map_err(dbus)
}

/// Sends one portal request and waits for its Response, closing the request
/// when access is revoked or the dialog goes unanswered.
async fn request<B>(
    conn: &Connection,
    interface: &str,
    method: &str,
    body: &B,
    handle_token: &str,
    state: &Shared,
) -> Result<zbus::Message, String>
where
    B: serde::Serialize + zvariant::DynamicType,
{
    let sender = conn
        .unique_name()
        .ok_or("The session bus connection has no name.")?
        .as_str()
        .trim_start_matches(':')
        .replace('.', "_");
    let expected = format!("{PORTAL_PATH}/request/{sender}/{handle_token}");
    let mut responses = subscribe(
        conn,
        "org.freedesktop.portal.Request",
        "Response",
        &expected,
    )
    .await?;
    let handle: OwnedObjectPath = call(conn, PORTAL, PORTAL_PATH, interface, method, body)
        .await?
        .body()
        .deserialize()
        .map_err(dbus)?;
    if handle.as_str() != expected {
        responses = subscribe(
            conn,
            "org.freedesktop.portal.Request",
            "Response",
            handle.as_str(),
        )
        .await?;
    }
    let deadline = tokio::time::Instant::now() + DIALOG_LIMIT;
    loop {
        tokio::select! {
            message = responses.next() => {
                return match message {
                    Some(Ok(message)) => Ok(message),
                    Some(Err(error)) => Err(dbus(error)),
                    None => Err("The desktop portal stopped responding.".into()),
                };
            }
            _ = tokio::time::sleep(Duration::from_millis(200)) => {
                let canceled = state.current().0 == "canceled";
                if canceled || tokio::time::Instant::now() >= deadline {
                    let _ = call(conn, PORTAL, handle.as_str(), "org.freedesktop.portal.Request", "Close", &()).await;
                    return Err(if canceled {
                        "Desktop access was revoked before the system dialog was answered.".into()
                    } else {
                        "The system dialog was not answered in time. Request access again.".into()
                    });
                }
            }
        }
    }
}

async fn close_session(conn: &Connection, session: &OwnedObjectPath) {
    let _ = call(
        conn,
        PORTAL,
        session.as_str(),
        "org.freedesktop.portal.Session",
        "Close",
        &(),
    )
    .await;
}

fn session_handle(results: &HashMap<String, OwnedValue>) -> Result<OwnedObjectPath, String> {
    let text = match results.get("session_handle").map(|value| &**value) {
        Some(zvariant::Value::Str(text)) => text.as_str().to_owned(),
        Some(zvariant::Value::ObjectPath(path)) => path.as_str().to_owned(),
        _ => return Err("The desktop portal returned no session.".into()),
    };
    OwnedObjectPath::try_from(text).map_err(dbus)
}

/// Runs the portal sequence for a scope. Returns the live session and the
/// portal's new restore token, if any.
async fn open(
    scope: Scope,
    restore: Option<String>,
    state: Arc<Shared>,
) -> Result<(Live, Option<String>), String> {
    let conn = Connection::session().await.map_err(dbus)?;
    let version = portal_u32(&conn, REMOTE, "version").await;
    let mut session: Option<OwnedObjectPath> = None;
    let mut closed = None;
    let mut streams = Vec::new();
    let mut restore_token = None;
    let result: Result<(), String> = async {
        for step in portal::steps(scope) {
            let handle_token = token();
            let mut options: HashMap<&str, zvariant::Value> = HashMap::new();
            options.insert("handle_token", handle_token.as_str().into());
            let session_token = token();
            let message = match (step, &session) {
                (Step::CreateSession, _) => {
                    options.insert("session_handle_token", session_token.as_str().into());
                    request(
                        &conn,
                        REMOTE,
                        step.method(),
                        &(options,),
                        &handle_token,
                        &state,
                    )
                    .await?
                }
                (Step::SelectDevices, Some(path)) => {
                    options.insert("types", portal::devices(scope).into());
                    if version >= 2 {
                        options.insert("persist_mode", 2u32.into());
                        if let Some(token) = &restore {
                            options.insert("restore_token", token.as_str().into());
                        }
                    }
                    request(
                        &conn,
                        REMOTE,
                        step.method(),
                        &(path.clone(), options),
                        &handle_token,
                        &state,
                    )
                    .await?
                }
                (Step::SelectSources, Some(path)) => {
                    options.insert("types", portal::SOURCE_MONITOR.into());
                    options.insert("multiple", true.into());
                    request(
                        &conn,
                        SCREENCAST,
                        step.method(),
                        &(path.clone(), options),
                        &handle_token,
                        &state,
                    )
                    .await?
                }
                (Step::Start, Some(path)) => {
                    request(
                        &conn,
                        REMOTE,
                        step.method(),
                        &(path.clone(), "", options),
                        &handle_token,
                        &state,
                    )
                    .await?
                }
                _ => return Err("The desktop portal session was not created.".into()),
            };
            if *step == Step::Start {
                let (code, results): (u32, StartResults) =
                    message.body().deserialize().map_err(dbus)?;
                portal::response(*step, code)?;
                restore_token = results.restore_token;
                streams = results
                    .streams
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(|(node, properties)| {
                        let (x, y) = properties.position.unwrap_or((0, 0));
                        let (width, height) = properties.size?;
                        (width > 0 && height > 0).then_some(Stream {
                            node,
                            x,
                            y,
                            width,
                            height,
                        })
                    })
                    .collect();
                continue;
            }
            let (code, results): (u32, HashMap<String, OwnedValue>) =
                message.body().deserialize().map_err(dbus)?;
            portal::response(*step, code)?;
            if *step == Step::CreateSession {
                let path = session_handle(&results)?;
                let mut signal = subscribe(
                    &conn,
                    "org.freedesktop.portal.Session",
                    "Closed",
                    path.as_str(),
                )
                .await?;
                let watcher = state.clone();
                closed = Some(tokio::spawn(async move {
                    if signal.next().await.is_some() {
                        watcher.cancel(
                            "Remote control was stopped from your desktop's sharing indicator.",
                        );
                    }
                }));
                session = Some(path);
            }
        }
        if scope == Scope::Desktop && streams.is_empty() {
            return Err("No monitor was shared. Request access again and choose a monitor.".into());
        }
        Ok(())
    }
    .await;
    match (result, session, closed) {
        (Ok(()), Some(session), Some(closed)) => Ok((
            Live {
                connection: conn,
                session,
                streams,
                closed,
            },
            restore_token,
        )),
        (result, session, closed) => {
            if let Some(closed) = closed {
                closed.abort();
            }
            if let Some(session) = &session {
                close_session(&conn, session).await;
            }
            Err(result
                .err()
                .unwrap_or_else(|| "The desktop portal session was not created.".into()))
        }
    }
}

fn no_options() -> HashMap<&'static str, zvariant::Value<'static>> {
    HashMap::new()
}

impl Live {
    async fn notify<B>(&self, method: &str, body: &B) -> Result<(), String>
    where
        B: serde::Serialize + zvariant::DynamicType,
    {
        call(&self.connection, PORTAL, PORTAL_PATH, REMOTE, method, body)
            .await
            .map(|_| ())
            .map_err(|error| {
                format!("{error} Input may have partly occurred; inspect before retrying.")
            })
    }

    async fn key(&self, keysym: u32, pressed: bool) -> Result<(), String> {
        self.notify(
            "NotifyKeyboardKeysym",
            &(
                self.session.clone(),
                no_options(),
                keysym as i32,
                pressed as u32,
            ),
        )
        .await
    }

    async fn chord(&self, modifiers: &[u32], key: u32) -> Result<(), String> {
        for modifier in modifiers {
            self.key(*modifier, true).await?;
        }
        let result = async {
            self.key(key, true).await?;
            self.key(key, false).await
        }
        .await;
        for modifier in modifiers.iter().rev() {
            let _ = self.key(*modifier, false).await;
        }
        result
    }

    async fn motion(&self, stream: &Stream, x: f64, y: f64) -> Result<(), String> {
        self.notify(
            "NotifyPointerMotionAbsolute",
            &(self.session.clone(), no_options(), stream.node, x, y),
        )
        .await
    }

    async fn button(&self, button: i32, pressed: bool) -> Result<(), String> {
        self.notify(
            "NotifyPointerButton",
            &(self.session.clone(), no_options(), button, pressed as u32),
        )
        .await
    }

    async fn click(&self, button: i32, count: usize) -> Result<(), String> {
        for _ in 0..count {
            self.button(button, true).await?;
            self.button(button, false).await?;
        }
        Ok(())
    }

    async fn scroll(&self, steps: i32) -> Result<(), String> {
        self.notify(
            "NotifyPointerAxisDiscrete",
            &(self.session.clone(), no_options(), 0u32, steps),
        )
        .await
    }

    async fn close(&self) {
        self.closed.abort();
        close_session(&self.connection, &self.session).await;
    }
}

// ---- accessibility ----

#[derive(Clone, Debug)]
pub(crate) struct Node {
    bus: String,
    path: String,
}

struct Info {
    role: String,
    name: String,
    states: Vec<u32>,
    interfaces: Vec<String>,
}

struct Listed {
    window: Value,
    node: Node,
    states: Vec<u32>,
}

impl Node {
    fn root() -> Self {
        Self {
            bus: "org.a11y.atspi.Registry".into(),
            path: "/org/a11y/atspi/accessible/root".into(),
        }
    }

    async fn call<B, R>(
        &self,
        conn: &Connection,
        interface: &str,
        method: &str,
        body: &B,
    ) -> Result<R, String>
    where
        B: serde::Serialize + zvariant::DynamicType,
        R: for<'d> serde::Deserialize<'d> + Type,
    {
        call(conn, &self.bus, &self.path, interface, method, body)
            .await?
            .body()
            .deserialize::<R>()
            .map_err(dbus)
    }

    async fn get<R: TryFrom<OwnedValue>>(
        &self,
        conn: &Connection,
        interface: &str,
        name: &str,
    ) -> Result<R, String> {
        let value = property(conn, &self.bus, &self.path, interface, name).await?;
        R::try_from(value)
            .map_err(|_| "The app returned an unexpected accessibility value.".to_string())
    }

    async fn children(&self, conn: &Connection) -> Result<Vec<Node>, String> {
        let children: Vec<(String, OwnedObjectPath)> =
            self.call(conn, ACCESSIBLE, "GetChildren", &()).await?;
        Ok(children
            .into_iter()
            .map(|(bus, path)| Node {
                bus,
                path: path.as_str().to_owned(),
            })
            .collect())
    }

    async fn info(&self, conn: &Connection) -> Result<Info, String> {
        Ok(Info {
            role: self.call(conn, ACCESSIBLE, "GetRoleName", &()).await?,
            name: self
                .get::<String>(conn, ACCESSIBLE, "Name")
                .await
                .unwrap_or_default(),
            states: self
                .call(conn, ACCESSIBLE, "GetState", &())
                .await
                .unwrap_or_default(),
            interfaces: self
                .call(conn, ACCESSIBLE, "GetInterfaces", &())
                .await
                .unwrap_or_default(),
        })
    }

    async fn text(&self, conn: &Connection) -> Option<String> {
        let count: i32 = self.get(conn, TEXT, "CharacterCount").await.ok()?;
        let text: String = self
            .call(conn, TEXT, "GetText", &(0i32, count.clamp(0, 200)))
            .await
            .ok()?;
        Some(text.chars().take(200).collect())
    }

    async fn actions(&self, conn: &Connection) -> Vec<String> {
        self.call::<_, Vec<(String, String, String)>>(conn, ACTION, "GetActions", &())
            .await
            .map(|actions| actions.into_iter().map(|(name, _, _)| name).collect())
            .unwrap_or_default()
    }

    async fn pid(&self, conn: &Connection) -> Result<u32, String> {
        call(
            conn,
            "org.freedesktop.DBus",
            "/org/freedesktop/DBus",
            "org.freedesktop.DBus",
            "GetConnectionUnixProcessID",
            &(self.bus.as_str(),),
        )
        .await?
        .body()
        .deserialize::<u32>()
        .map_err(dbus)
    }
}

fn has(info: &Info, interface: &str) -> bool {
    info.interfaces.iter().any(|name| name == interface)
}

/// Top-level windows of accessible apps, with their process identity.
async fn windows(conn: &Connection) -> Result<Vec<Listed>, String> {
    let mut listed = Vec::new();
    for app in Node::root().children(conn).await?.into_iter().take(100) {
        let Ok(pid) = app.pid(conn).await else {
            continue;
        };
        let Some(started) = std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .ok()
            .and_then(|stat| portal::process_start(&stat))
        else {
            continue;
        };
        let app_name: String = app.get(conn, ACCESSIBLE, "Name").await.unwrap_or_default();
        if app_name.trim().is_empty() {
            continue;
        }
        let Ok(children) = app.children(conn).await else {
            continue;
        };
        for node in children.into_iter().take(20) {
            let Ok(info) = node.info(conn).await else {
                continue;
            };
            if !["frame", "window", "dialog"].contains(&info.role.as_str()) {
                continue;
            }
            let title = if info.name.trim().is_empty() {
                app_name.clone()
            } else {
                info.name.clone()
            };
            listed.push(Listed {
                window: json!({
                    "handle": portal::handle(&node.bus, &node.path),
                    "pid": pid,
                    "started": started,
                    "title": title.chars().take(200).collect::<String>(),
                    "class": portal::app_key(&app_name),
                    "app": portal::app_key(&app_name),
                    "appName": app_name.chars().take(80).collect::<String>(),
                }),
                node,
                states: info.states,
            });
            if listed.len() >= 40 {
                return Ok(listed);
            }
        }
    }
    Ok(listed)
}

fn same_window(listed: &Listed, wanted: &Value) -> bool {
    listed.window["handle"] == wanted["handle"]
        && listed.window["pid"] == wanted["pid"]
        && listed.window["started"] == wanted["started"]
}

/// Walks an accessible subtree into snapshot elements, recording each ref's
/// object so element actions reach the same accessible.
async fn tree(
    conn: &Connection,
    root: Node,
    limit: usize,
    refs: &mut HashMap<String, Node>,
) -> Result<(Vec<Value>, Option<String>), String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    let mut elements = Vec::new();
    let mut url = None;
    let mut stack = vec![(root, 0usize, false)];
    while let Some((node, depth, protected_parent)) = stack.pop() {
        if elements.len() >= limit || tokio::time::Instant::now() > deadline {
            break;
        }
        let Ok(info) = node.info(conn).await else {
            continue;
        };
        let password = protected_parent || portal::is_password_role(&info.role);
        let reference = format!("e{}", elements.len() + 1);
        let mut element = json!({
            "ref": reference,
            "role": info.role,
            "depth": depth,
            "states": portal::state_names(&info.states),
            "password": password,
        });
        if !password {
            element["name"] = json!(info.name.chars().take(200).collect::<String>());
            if has(&info, TEXT) {
                if let Some(text) = node.text(conn).await {
                    element["value"] = json!(text);
                }
            }
            if has(&info, ACTION) {
                element["actions"] = json!(node.actions(conn).await);
            }
            if url.is_none() && has(&info, DOCUMENT) && info.role.starts_with("document") {
                for attribute in ["DocURL", "URI"] {
                    if let Ok(value) = node
                        .call::<_, String>(conn, DOCUMENT, "GetAttributeValue", &(attribute,))
                        .await
                    {
                        if !value.is_empty() {
                            url = Some(value);
                            break;
                        }
                    }
                }
            }
        }
        refs.insert(reference, node.clone());
        elements.push(element);
        if !password && depth < 12 {
            if let Ok(children) = node.children(conn).await {
                for child in children.into_iter().take(160).rev() {
                    stack.push((child, depth + 1, password));
                }
            }
        }
    }
    Ok((elements, url))
}

/// The first web document under a window, for page snapshots.
async fn document(conn: &Connection, root: &Node) -> Option<Node> {
    let mut queue = std::collections::VecDeque::from([(root.clone(), 0)]);
    let mut visited = 0;
    while let Some((node, depth)) = queue.pop_front() {
        visited += 1;
        if visited > 600 {
            return None;
        }
        let info = node.info(conn).await.ok()?;
        if info.role.starts_with("document") {
            return Some(node);
        }
        if depth < 30 {
            for child in node
                .children(conn)
                .await
                .unwrap_or_default()
                .into_iter()
                .take(160)
            {
                queue.push_back((child, depth + 1));
            }
        }
    }
    None
}

/// The focused control inside a window. Password controls are rejected.
async fn focused(conn: &Connection, root: &Node) -> Result<Node, String> {
    let mut stack = vec![(root.clone(), 0)];
    let mut visited = 0;
    while let Some((node, depth)) = stack.pop() {
        visited += 1;
        if visited > 800 {
            break;
        }
        let Ok(info) = node.info(conn).await else {
            continue;
        };
        if portal::has_state(&info.states, portal::STATE_FOCUSED) && depth > 0 {
            if portal::is_password_role(&info.role) {
                return Err("Typing and keypresses are blocked in password controls.".into());
            }
            return Ok(node);
        }
        if depth < 30 {
            for child in node
                .children(conn)
                .await
                .unwrap_or_default()
                .into_iter()
                .take(160)
                .rev()
            {
                stack.push((child, depth + 1));
            }
        }
    }
    Err(
        "The focused control cannot be found inside the selected window. Focus an element first."
            .into(),
    )
}

/// Inserts literal text at the caret, replacing a single selection.
async fn insert_text(conn: &Connection, node: &Node, text: &str) -> Result<bool, String> {
    let info = node.info(conn).await?;
    if portal::is_password_role(&info.role) {
        return Err("Typing is blocked in password controls.".into());
    }
    if !has(&info, EDITABLE) || !has(&info, TEXT) {
        return Ok(false);
    }
    let mut offset: i32 = node.get(conn, TEXT, "CaretOffset").await?;
    let selections: i32 = node.call(conn, TEXT, "GetNSelections", &()).await?;
    if selections > 1 {
        return Err("Multiple text selections are not supported.".into());
    }
    if selections == 1 {
        let (start, end): (i32, i32) = node.call(conn, TEXT, "GetSelection", &(0i32,)).await?;
        if start < 0 || end < start {
            return Err("Cannot identify selected text.".into());
        }
        let deleted: bool = node
            .call(conn, EDITABLE, "DeleteText", &(start, end))
            .await?;
        if !deleted {
            return Err(
                "The app refused to replace selected text. Inspect before retrying.".into(),
            );
        }
        offset = start;
    }
    if offset < 0 {
        return Err("Cannot identify the text caret.".into());
    }
    let inserted: bool = node
        .call(
            conn,
            EDITABLE,
            "InsertText",
            &(offset, text, text.len() as i32),
        )
        .await?;
    if !inserted {
        return Err("The app refused literal text insertion. Inspect before retrying.".into());
    }
    let caret = offset + text.chars().count() as i32;
    let moved: bool = node
        .call(conn, TEXT, "SetCaretOffset", &(caret,))
        .await
        .unwrap_or(false);
    if !moved {
        return Err(
            "Text was inserted but the caret could not be updated. Inspect before further input."
                .into(),
        );
    }
    Ok(true)
}

async fn do_action(conn: &Connection, node: &Node, action: &str) -> Result<bool, String> {
    let names = node.actions(conn).await;
    let Some(index) = portal::pick_action(&names, action) else {
        return Ok(false);
    };
    let done: bool = node
        .call(conn, ACTION, "DoAction", &(index as i32,))
        .await?;
    if !done {
        return Err("The app refused the accessibility action. Inspect before retrying.".into());
    }
    Ok(true)
}

// ---- backend ----

fn sent(method: &str) -> Value {
    json!({"status": "sent", "method": method, "focusChanged": false})
}

fn number(value: &Value) -> Option<i64> {
    value.as_i64()
}

pub(crate) struct Backend {
    shared: Option<Arc<Shared>>,
    live: Arc<Mutex<Option<Arc<Live>>>>,
    a11y: Option<Connection>,
    refs: HashMap<String, Node>,
    monitor: usize,
}

impl Backend {
    pub fn new() -> Self {
        Self {
            shared: None,
            live: Arc::default(),
            a11y: None,
            refs: HashMap::new(),
            monitor: 0,
        }
    }

    /// Starts the portal sequence in the background. The returned state waits
    /// for the system dialog, then becomes active or canceled.
    pub fn start(&mut self, scope: Scope, tokens: PathBuf, project_id: String) -> Arc<Shared> {
        self.shutdown();
        let shared = Arc::new(Shared::waiting());
        self.shared = Some(shared.clone());
        let runtime = match runtime() {
            Ok(runtime) => runtime,
            Err(error) => {
                shared.cancel(&error);
                return shared;
            }
        };
        let slot = self.live.clone();
        let state = shared.clone();
        runtime.spawn(async move {
            let restore = portal::restore_token(&tokens, &project_id, scope);
            match open(scope, restore, state.clone()).await {
                Ok((live, token)) => {
                    if token.is_some() {
                        let _ = portal::save_token(&tokens, &project_id, scope, token.as_deref());
                    }
                    let live = Arc::new(live);
                    let stale = {
                        let mut slot = slot
                            .lock()
                            .unwrap_or_else(std::sync::PoisonError::into_inner);
                        if state.current().0 == "canceled" {
                            true
                        } else {
                            *slot = Some(live.clone());
                            state.activate();
                            false
                        }
                    };
                    if stale {
                        live.close().await;
                    }
                }
                Err(message) => state.cancel(&message),
            }
        });
        shared
    }

    pub fn shutdown(&mut self) {
        let live = {
            let mut slot = self
                .live
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(shared) = &self.shared {
                shared.cancel("Desktop access was released.");
            }
            slot.take()
        };
        self.refs.clear();
        if let (Some(live), Ok(runtime)) = (live, runtime()) {
            runtime.spawn(async move { live.close().await });
        }
    }

    fn live(&self) -> Result<Arc<Live>, String> {
        self.live
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone()
            .ok_or_else(|| portal::WAITING.to_string())
    }

    pub fn call(
        &mut self,
        payload: &Value,
        timeout: Duration,
        canceled: &AtomicBool,
    ) -> Result<Value, String> {
        if canceled.load(Ordering::SeqCst) {
            return Err("Desktop access was revoked.".into());
        }
        let result = run(async {
            tokio::time::timeout(timeout, self.handle(payload))
                .await
                .unwrap_or_else(|_| Err("The desktop operation timed out. Inspect the window before retrying; an action may have occurred.".into()))
        })?;
        if result.is_err() {
            self.a11y = None;
        }
        if canceled.load(Ordering::SeqCst) {
            return Err("Desktop access was revoked. An in-flight action may have occurred; do not replay it.".into());
        }
        result
    }

    async fn accessibility(&mut self) -> Result<Connection, String> {
        if let Some(conn) = &self.a11y {
            return Ok(conn.clone());
        }
        let session = Connection::session().await.map_err(dbus)?;
        let conn = accessibility_bus(&session)
            .await
            .map_err(|_| "The accessibility service is unavailable. Enable assistive technologies for this desktop.".to_string())?;
        self.a11y = Some(conn.clone());
        Ok(conn)
    }

    fn check(&self, payload: &Value) -> Result<(), String> {
        self.shared
            .as_ref()
            .ok_or("No desktop grant.")?
            .check(payload["guard"]["epoch"].as_u64())
    }

    fn monitors(&self) -> Value {
        let streams = self
            .live()
            .map(|live| live.streams.clone())
            .unwrap_or_default();
        Value::Array(
            streams
                .iter()
                .enumerate()
                .map(|(index, s)| json!({"index": index, "bounds": [s.x, s.y, s.width, s.height], "primary": index == 0}))
                .collect(),
        )
    }

    async fn handle(&mut self, payload: &Value) -> Result<Value, String> {
        let action = payload["action"].as_str().unwrap_or_default();
        let conn = self.accessibility().await;
        if action == "list" {
            // Desktop grants work without accessibility; app grants then find no windows.
            let windows: Vec<Value> = match &conn {
                Ok(conn) => windows(conn)
                    .await?
                    .into_iter()
                    .map(|listed| listed.window)
                    .collect(),
                Err(_) => Vec::new(),
            };
            return Ok(json!({"windows": windows, "monitors": self.monitors()}));
        }
        self.check(payload)?;
        let window = &payload["window"];
        let screen = payload["surface"] == "screen" || window.is_null();
        match action {
            "screenshot" => return self.screenshot(payload).await,
            "snapshot" if screen => {
                self.monitor = payload["monitor"].as_u64().unwrap_or(0) as usize;
                let live = self.live()?;
                let stream = *live
                    .streams
                    .get(self.monitor)
                    .ok_or("That monitor is not shared. Call list_windows for shared monitors.")?;
                let windows: Vec<Value> = match conn {
                    Ok(conn) => windows(&conn)
                        .await?
                        .into_iter()
                        .map(|listed| listed.window)
                        .collect(),
                    Err(_) => Vec::new(),
                };
                self.refs.clear();
                return Ok(json!({
                    "elements": [],
                    "windows": windows,
                    "monitors": self.monitors(),
                    "bounds": {"x": 0, "y": 0, "width": stream.width, "height": stream.height},
                    "note": "Window positions are private to this compositor. Take a screenshot for coordinates, or switch_window and snapshot for element refs.",
                }));
            }
            "focus" if payload["element"].is_null() => {
                return Ok(
                    json!({"status": "unchanged", "note": "This desktop does not let Jackalope raise windows. Keyboard input needs the window to be active."}),
                );
            }
            _ => {}
        }
        let conn = conn?;
        let listed = if screen {
            None
        } else {
            Some(
                windows(&conn)
                    .await?
                    .into_iter()
                    .find(|listed| same_window(listed, window))
                    .ok_or("The selected window closed or changed. Call list_windows, or request access again.")?,
            )
        };
        if action == "snapshot" {
            let listed = listed.ok_or("Switch to a window in the grant first.")?;
            let mut refs = HashMap::new();
            let page = payload["page"] == true;
            let (root, limit) = match page {
                true => (
                    document(&conn, &listed.node)
                        .await
                        .ok_or("No web page document was found in this window.")?,
                    400,
                ),
                false => (listed.node.clone(), 160),
            };
            let (elements, url) = tree(&conn, root, limit, &mut refs).await?;
            self.refs = refs;
            let mut result = json!({"elements": elements, "bounds": null});
            if let Some(url) = url {
                result["site"] = json!({"url": url});
            }
            return Ok(result);
        }
        self.input(&conn, payload, action, listed.as_ref()).await
    }

    fn element(&self, payload: &Value, field: &str) -> Result<Option<Node>, String> {
        match payload[field].as_str() {
            Some(reference) => self.refs.get(reference).cloned().map(Some).ok_or_else(|| {
                format!("Element {reference} is not in the latest snapshot. Take a new snapshot.")
            }),
            None => Ok(None),
        }
    }

    /// Keyboard input reaches whichever window is active: the selected window
    /// for app grants, anything but Jackalope for desktop grants. A focused
    /// password control in that window blocks keyboard input.
    async fn keyboard_target(
        &self,
        conn: &Connection,
        payload: &Value,
        listed: Option<&Listed>,
    ) -> Result<(), String> {
        let current = windows(conn).await?;
        let active = current
            .iter()
            .find(|item| portal::has_state(&item.states, portal::STATE_ACTIVE));
        if payload["scope"] == "desktop" {
            let denied = denied(payload);
            if active.is_some_and(|item| {
                item.window["pid"]
                    .as_u64()
                    .is_some_and(|pid| denied.contains(&pid))
            }) {
                return Err(
                    "Jackalope is the active window. Switch to the app to control first.".into(),
                );
            }
        } else {
            let listed = listed.ok_or("Switch to a window in the grant first.")?;
            if !active.is_some_and(|item| same_window(item, &listed.window)) {
                return Err(format!(
                    "\u{201c}{}\u{201d} is not the active window. Bring it forward yourself, then take a new snapshot; this desktop does not let Jackalope raise windows.",
                    listed.window["title"].as_str().unwrap_or_default()
                ));
            }
        }
        if let Some(active) = active {
            if let Err(error) = focused(conn, &active.node).await {
                if error.contains("password") {
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    /// The portal cannot locate Jackalope's windows, so screen coordinates are
    /// accepted only while none of them is showing.
    async fn pointer_target(
        &self,
        conn: &Connection,
        payload: &Value,
    ) -> Result<(Arc<Live>, Stream), String> {
        let denied = denied(payload);
        if windows(conn).await?.iter().any(|item| {
            item.window["pid"]
                .as_u64()
                .is_some_and(|pid| denied.contains(&pid))
                && portal::has_state(&item.states, portal::STATE_SHOWING)
                && !portal::has_state(&item.states, portal::STATE_ICONIFIED)
        }) {
            return Err("Minimize Jackalope before pointer input on this desktop; the compositor does not report where its windows are.".into());
        }
        let live = self.live()?;
        let stream = *live
            .streams
            .get(self.monitor)
            .ok_or("Pointer input needs a shared monitor. Take a screenshot first.")?;
        let bounds = &payload["bounds"];
        if number(&bounds["width"]) != Some(stream.width as i64)
            || number(&bounds["height"]) != Some(stream.height as i64)
        {
            return Err("The shared monitor changed. Take a new screenshot.".into());
        }
        Ok((live, stream))
    }

    fn point(stream: &Stream, payload: &Value, x: &str, y: &str) -> Result<(f64, f64), String> {
        let (Some(px), Some(py)) = (number(&payload[x]), number(&payload[y])) else {
            return Err("On this desktop, pointer input needs x and y from a monitor screenshot; element refs use accessibility actions.".into());
        };
        if px < 0 || py < 0 || px >= stream.width as i64 || py >= stream.height as i64 {
            return Err("Point lies outside the captured monitor.".into());
        }
        Ok((px as f64, py as f64))
    }

    async fn input(
        &mut self,
        conn: &Connection,
        payload: &Value,
        action: &str,
        listed: Option<&Listed>,
    ) -> Result<Value, String> {
        let element = self.element(payload, "element")?;
        let text = payload["text"].as_str().unwrap_or_default();
        if let Some(node) = &element {
            match action {
                "click" | "invoke" | "double_click" | "right_click" => {
                    if do_action(conn, node, action).await? {
                        return Ok(sent("accessibility"));
                    }
                    return Err("This element offers no matching accessibility action. On this desktop pointer input needs a full-desktop grant and coordinates from a screenshot.".into());
                }
                "focus" => {
                    let focused: bool = node.call(conn, COMPONENT, "GrabFocus", &()).await?;
                    return if focused {
                        Ok(sent("accessibility"))
                    } else {
                        Err("The app refused to focus this element.".into())
                    };
                }
                "set_value" => {
                    let info = node.info(conn).await?;
                    if portal::is_password_role(&info.role) {
                        return Err(
                            "Password controls are protected. Enter secrets yourself.".into()
                        );
                    }
                    if has(&info, EDITABLE) {
                        let done: bool = node
                            .call(conn, EDITABLE, "SetTextContents", &(text,))
                            .await?;
                        return if done {
                            Ok(sent("accessibility"))
                        } else {
                            Err("The app refused the new value.".into())
                        };
                    }
                    if has(&info, VALUE) {
                        let value: f64 = text
                            .trim()
                            .parse()
                            .map_err(|_| "This control takes a number.")?;
                        call(
                            conn,
                            &node.bus,
                            &node.path,
                            PROPERTIES,
                            "Set",
                            &(VALUE, "CurrentValue", zvariant::Value::from(value)),
                        )
                        .await?;
                        return Ok(sent("accessibility"));
                    }
                    return Err("This element accepts no value through accessibility.".into());
                }
                "select" => {
                    let wanted = text.trim().to_lowercase();
                    let info = node.info(conn).await?;
                    for (index, child) in
                        node.children(conn).await?.into_iter().take(500).enumerate()
                    {
                        let name: String = child
                            .get(conn, ACCESSIBLE, "Name")
                            .await
                            .unwrap_or_default();
                        if name.trim().to_lowercase() != wanted {
                            continue;
                        }
                        if has(&info, SELECTION) {
                            let done: bool = node
                                .call(conn, SELECTION, "SelectChild", &(index as i32,))
                                .await?;
                            if done {
                                return Ok(sent("accessibility"));
                            }
                        }
                        if do_action(conn, &child, "click").await? {
                            return Ok(sent("accessibility"));
                        }
                        return Err("The app refused to select that option.".into());
                    }
                    return Err(format!(
                        "No option named \u{201c}{}\u{201d} was found in this element.",
                        text.trim()
                    ));
                }
                _ => {}
            }
        }
        match action {
            "type" => {
                let target = match element.clone() {
                    Some(node) => {
                        let _: bool = node
                            .call(conn, COMPONENT, "GrabFocus", &())
                            .await
                            .unwrap_or(false);
                        Some(node)
                    }
                    None => match listed {
                        Some(listed) => Some(focused(conn, &listed.node).await?),
                        None => None,
                    },
                };
                if let Some(node) = &target {
                    if insert_text(conn, node, text).await? {
                        return Ok(sent("accessibility"));
                    }
                }
                self.keyboard_target(conn, payload, listed).await?;
                let live = self.live()?;
                let symbols: Option<Vec<u32>> = text.chars().map(portal::char_keysym).collect();
                for symbol in symbols.ok_or("Control characters are not allowed.")? {
                    live.chord(&[], symbol).await?;
                }
                Ok(sent("keyboard"))
            }
            "press" => {
                self.keyboard_target(conn, payload, listed).await?;
                let chord = &payload["chord"];
                let modifiers: Option<Vec<u32>> = chord["modifiers"]
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(portal::keysym)
                            .collect()
                    })
                    .unwrap_or(Some(Vec::new()));
                let key = chord["key"].as_str().and_then(portal::keysym);
                let (Some(modifiers), Some(key)) = (modifiers, key) else {
                    return Err("Unsupported key on this desktop.".into());
                };
                self.live()?.chord(&modifiers, key).await?;
                Ok(sent("keyboard"))
            }
            "click" | "double_click" | "right_click" | "scroll" | "drag" => {
                if payload["scope"] != "desktop" {
                    return Err("On this desktop, pointer input at coordinates needs a full-desktop grant, because window positions are private to the compositor. Use element refs here.".into());
                }
                let (live, stream) = self.pointer_target(conn, payload).await?;
                let (x, y) = Self::point(&stream, payload, "x", "y")?;
                live.motion(&stream, x, y).await?;
                match action {
                    "click" => live.click(BTN_LEFT, 1).await?,
                    "double_click" => live.click(BTN_LEFT, 2).await?,
                    "right_click" => live.click(BTN_RIGHT, 1).await?,
                    "scroll" => {
                        let wheel = number(&payload["wheel"])
                            .filter(|n| *n != 0 && n.abs() <= 10)
                            .ok_or("Invalid scroll input.")?;
                        live.scroll(-(wheel as i32)).await?
                    }
                    _ => {
                        let (to_x, to_y) = Self::point(&stream, payload, "to_x", "to_y")?;
                        live.button(BTN_LEFT, true).await?;
                        let moved = async {
                            for step in 1..=8 {
                                let t = step as f64 / 8.0;
                                live.motion(&stream, x + (to_x - x) * t, y + (to_y - y) * t)
                                    .await?;
                                tokio::time::sleep(Duration::from_millis(16)).await;
                            }
                            Ok::<(), String>(())
                        }
                        .await;
                        live.button(BTN_LEFT, false).await?;
                        moved?;
                    }
                }
                Ok(sent("pointer"))
            }
            "focus" | "invoke" | "select" | "set_value" => {
                Err(format!("Supply an element ref for {action}."))
            }
            _ => Err("Unsupported desktop action.".into()),
        }
    }

    async fn screenshot(&mut self, payload: &Value) -> Result<Value, String> {
        if payload["scope"] != "desktop" {
            return Err("Screenshots on this desktop capture whole monitors, so they need a full-desktop grant. Use snapshot for app grants.".into());
        }
        let live = self.live()?;
        let index = payload["monitor"].as_u64().unwrap_or(self.monitor as u64) as usize;
        let stream = *live
            .streams
            .get(index)
            .ok_or("That monitor is not shared. Call list_windows for shared monitors.")?;
        let state = self.shared.clone().ok_or("No desktop grant.")?;
        let handle_token = token();
        let mut options: HashMap<&str, zvariant::Value> = HashMap::new();
        options.insert("handle_token", handle_token.as_str().into());
        options.insert("interactive", false.into());
        let message = request(
            &live.connection,
            SCREENSHOT,
            "Screenshot",
            &("", options),
            &handle_token,
            &state,
        )
        .await?;
        let (code, results): (u32, HashMap<String, OwnedValue>) =
            message.body().deserialize().map_err(dbus)?;
        if code != 0 {
            return Err("The desktop declined the screenshot. Allow screenshots for Jackalope in your desktop's privacy settings.".into());
        }
        let uri = results
            .get("uri")
            .and_then(|value| String::try_from(value.clone()).ok())
            .ok_or("The desktop returned no screenshot.")?;
        let file = portal::file_uri_path(&uri)
            .ok_or("The desktop returned an unreadable screenshot location.")?;
        let metadata = std::fs::symlink_metadata(&file).map_err(|e| e.to_string())?;
        if !metadata.is_file() || metadata.len() > 64 * 1024 * 1024 {
            return Err("The desktop returned an unusable screenshot.".into());
        }
        let bytes = std::fs::read(&file);
        // The portal wrote this file for this request; it is not the user's.
        let _ = std::fs::remove_file(&file);
        let (width, height, pixels) = decode(&bytes.map_err(|e| e.to_string())?)?;
        let region = portal::crop(&live.streams, index, width, height)?;
        let pixels = portal::crop_rgba(&pixels, width, region);
        let logical = (stream.width as u32, stream.height as u32);
        let pixels =
            portal::resize_rgba(&pixels, region.width, region.height, logical.0, logical.1);
        let (out_width, out_height) = portal::fit(
            logical.0,
            logical.1,
            payload["thumb"].as_u64().map(|n| n as u32),
        );
        let pixels = portal::resize_rgba(&pixels, logical.0, logical.1, out_width, out_height);
        let path = payload["path"].as_str().ok_or("Missing capture path.")?;
        std::fs::write(path, encode(out_width, out_height, &pixels)?).map_err(|e| e.to_string())?;
        if payload["thumb"].is_null() {
            self.monitor = index;
        }
        Ok(json!({
            "bounds": {"x": 0, "y": 0, "width": stream.width, "height": stream.height},
            "monitor": index,
        }))
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn denied(payload: &Value) -> Vec<u64> {
    payload["deny"]
        .as_array()
        .map(|items| items.iter().filter_map(Value::as_u64).collect())
        .unwrap_or_default()
}

fn decode(bytes: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let size = reader
        .output_buffer_size()
        .ok_or("The screenshot is too large.")?;
    if size > 400 * 1024 * 1024 {
        return Err("The screenshot is too large.".into());
    }
    let mut buffer = vec![0; size];
    let info = reader.next_frame(&mut buffer).map_err(|e| e.to_string())?;
    buffer.truncate(info.buffer_size());
    let channels = info.color_type.samples();
    let pixels = match channels {
        4 => buffer,
        3 => buffer
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        2 => buffer
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        1 => buffer.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        _ => return Err("The screenshot uses an unsupported color format.".into()),
    };
    Ok((info.width, info.height, pixels))
}

fn encode(width: u32, height: u32, pixels: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(pixels).map_err(|e| e.to_string())?;
    }
    Ok(out)
}
