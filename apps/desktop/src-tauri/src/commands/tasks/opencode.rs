use super::*;
use reqwest::Method;
use serde_json::json;
use std::collections::{HashMap, HashSet};

const MAX_RESPONSE: usize = 4_000_000;

#[cfg(test)]
pub(super) fn configure_tools(
    command: &mut Command,
    directory: &Path,
    id: &str,
) -> Result<(), String> {
    let mode = if crate::commands::experiments::is("JACKALOPE_NATIVE_TOOLS", "bounded") {
        "bounded"
    } else {
        return Ok(());
    };
    let mut config: Value = serde_json::from_str(&crate::commands::mcp::opencode_config(
        &serde_json::Map::new(),
        command,
    )?)
    .map_err(|_| "Invalid OpenCode configuration.")?;
    if config.get("plugin").is_some_and(|value| !value.is_array()) {
        return Err("OpenCode plugins must be an array.".into());
    }
    let plugin = directory.join(format!("{id}.native-tools.mjs"));
    std::fs::write(&plugin, include_str!("opencode/tools.mjs")).map_err(|e| e.to_string())?;
    let url = reqwest::Url::from_file_path(&plugin)
        .map_err(|_| "The OpenCode plugin path must be absolute.")?;
    if config.get("plugin").is_none() {
        config["plugin"] = json!([]);
    }
    config["plugin"]
        .as_array_mut()
        .unwrap()
        .push(json!(url.as_str()));
    command
        .env("OPENCODE_CONFIG_CONTENT", config.to_string())
        .env("JACKALOPE_NATIVE_TOOLS", mode)
        .env(
            "JACKALOPE_NATIVE_TOOLS_RECEIPT",
            directory.join(format!("{id}.native-tools.jsonl")),
        );
    Ok(())
}

pub(super) struct Connection {
    listener: Option<std::net::TcpListener>,
    url: String,
    password: String,
}

impl Connection {
    pub fn configure(command: &mut Command) -> Result<Self, String> {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .map_err(|e| e.to_string())?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        let password = uuid::Uuid::new_v4().to_string();
        command.args([
            "serve",
            "--hostname",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ]);
        command
            .env("OPENCODE_SERVER_PASSWORD", &password)
            .env("OPENCODE_SERVER_USERNAME", "jackalope");
        Ok(Self {
            listener: Some(listener),
            url: format!("http://127.0.0.1:{port}"),
            password,
        })
    }

    pub fn release_port(&mut self) {
        self.listener.take();
    }

    pub fn drive(
        self,
        runtime: &TaskRuntime,
        run_id: &str,
        workspace: &str,
        previous: Option<&str>,
        model: Option<&str>,
        effort: Option<effort::TaskEffort>,
        input: &str,
        launched: std::time::Instant,
    ) -> Result<(), String> {
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(2))
                .build()
                .map_err(|e| e.to_string())?;
            let api = Api {
                connection: &self,
                client,
                workspace,
            };
            let operation = async {
                let started = std::time::Instant::now();
                loop {
                    if api
                        .json(Method::GET, "/global/health", None)
                        .await
                        .is_ok_and(|v| v["healthy"] == true)
                    {
                        break;
                    }
                    if started.elapsed() > Duration::from_secs(20) {
                        return Err("OpenCode's local server did not become ready. Update or repair the selected runner and retry.".into());
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                let session = if let Some(id) = previous {
                    valid_id(id)?;
                    let saved = api
                        .json(Method::GET, &format!("/session/{id}"), None)
                        .await?;
                    if saved["id"] != id || !same_workspace(saved["directory"].as_str(), workspace)
                    {
                        return Err(
                            "OpenCode returned a different session or workspace. Start a new task."
                                .into(),
                        );
                    }
                    id.to_owned()
                } else {
                    let saved = api
                        .json(
                            Method::POST,
                            "/session",
                            Some(json!({"title":format!("Jackalope task {run_id}")})),
                        )
                        .await?;
                    if !same_workspace(saved["directory"].as_str(), workspace) {
                        return Err("OpenCode created a session in a different workspace. Check the selected runner before retrying.".into());
                    }
                    valid_id(
                        saved["id"]
                            .as_str()
                            .ok_or("OpenCode did not create a session.")?,
                    )?
                    .to_owned()
                };
                let status = api.json(Method::GET, "/session/status", None).await?;
                if status.get(&session).is_some_and(|v| v["type"] != "idle") {
                    return Err("This OpenCode session is already active. Wait for its current turn before continuing.".into());
                }
                let mut stream = Stream::new(&session);
                if previous.is_some() {
                    api.restore_history(&mut stream).await?;
                }
                runtime.update_checked(run_id, |run| run.session_id = Some(session.clone()))?;
                let mut body = json!({"parts":[{"type":"text","text":input}]});
                if let Some(model) = model {
                    let (provider, name) = model
                        .split_once('/')
                        .filter(|(p, m)| !p.is_empty() && !m.is_empty())
                        .ok_or("OpenCode model IDs must use provider/model.")?;
                    body["model"] = json!({"providerID":provider,"modelID":name});
                    if let Some(effort) = effort.filter(|_| {
                        !crate::commands::experiments::is("JACKALOPE_PROVIDER_EFFORT", "off")
                    }) {
                        let effort =
                            if crate::commands::experiments::is("JACKALOPE_PROVIDER_EFFORT", "low")
                            {
                                effort::TaskEffort::Quick
                            } else {
                                effort
                            };
                        let providers = api.json(Method::GET, "/config/providers", None).await?;
                        if let Some(variant) = select_variant(&providers, provider, name, effort) {
                            body["variant"] = json!(variant);
                            runtime.update_checked(run_id, |run| {
                                run.reasoning_effort = Some(variant.into())
                            })?;
                        }
                    }
                }
                let mut events = api
                    .request(Method::GET, "/event")
                    .send()
                    .await
                    .map_err(|_| "Could not subscribe to OpenCode events.")?;
                if !events.status().is_success() {
                    return Err("OpenCode event subscription was rejected.".into());
                }
                api.json(
                    Method::POST,
                    &format!("/session/{session}/prompt_async"),
                    Some(body),
                )
                .await?;
                let mut frames = Frames::default();
                loop {
                    let chunk = events
                        .chunk()
                        .await
                        .map_err(|_| "The OpenCode event stream failed.")?
                        .ok_or("The OpenCode event stream ended before the task completed.")?;
                    for event in frames.push(&chunk)? {
                        let properties = &event["properties"];
                        let kind = event["type"].as_str().unwrap_or("");
                        if matches!(kind, "permission.asked" | "question.asked")
                            && stream.owns(properties["sessionID"].as_str())
                        {
                            api.answer(runtime, run_id, properties, kind == "permission.asked")
                                .await?;
                            continue;
                        }
                        if !stream.relevant(&event) {
                            continue;
                        }
                        let mut done = false;
                        let mut error = None;
                        runtime.update_output(run_id, |run| {
                            match stream.consume(run, &event) {
                                Ok(value) => done = value,
                                Err(value) => error = Some(value),
                            }
                            if stream.active {
                                run.efficiency.first_activity(launched.elapsed());
                            }
                        })?;
                        if let Some(error) = error {
                            return Err(error);
                        }
                        if done {
                            let (messages, _) = api.messages(&session, 1, None).await?;
                            let result = stream.finish(&messages)?;
                            runtime.update_checked(run_id, |run| run.result = result)?;
                            return Ok(());
                        }
                    }
                }
            };
            let stopped = async {
                loop {
                    let alive = {
                        let inner = runtime.inner.lock().unwrap();
                        !inner.canceled.contains(run_id)
                            && inner.processes.get(run_id).is_some_and(|p| {
                                p.lock().unwrap().try_wait().ok().flatten().is_none()
                            })
                    };
                    if !alive {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            };
            tokio::select! { result = operation => result, _ = stopped => Err("OpenCode task stopped or its server exited.".into()) }
        })
    }
}

fn same_workspace(directory: Option<&str>, workspace: &str) -> bool {
    directory
        .and_then(|p| std::fs::canonicalize(p).ok())
        .zip(std::fs::canonicalize(workspace).ok())
        .is_some_and(|(left, right)| left == right)
}

fn valid_id(value: &str) -> Result<&str, String> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err("OpenCode returned an invalid identifier.".into());
    }
    Ok(value)
}

fn select_variant<'a>(
    providers: &'a Value,
    provider: &str,
    model: &str,
    effort: effort::TaskEffort,
) -> Option<&'a str> {
    let variants = &providers["providers"]
        .as_array()?
        .iter()
        .find(|p| p["id"] == provider)?["models"][model]["variants"];
    let level = if provider == "deepseek" && effort == effort::TaskEffort::Balanced {
        "high"
    } else {
        effort.level()
    };
    variants
        .as_object()?
        .get_key_value(level)
        .filter(|(_, v)| v.is_object() && v["disabled"] != true)
        .map(|(key, _)| key.as_str())
}

struct Api<'a> {
    connection: &'a Connection,
    client: reqwest::Client,
    workspace: &'a str,
}
impl Api<'_> {
    async fn restore_history(&self, stream: &mut Stream) -> Result<(), String> {
        let mut pending = vec![stream.root.clone()];
        let mut pages = 0;
        while let Some(session) = pending.pop() {
            let children = self
                .json(Method::GET, &format!("/session/{session}/children"), None)
                .await?;
            for child in children
                .as_array()
                .ok_or("Invalid OpenCode child sessions.")?
            {
                if child["parentID"] != session {
                    return Err("OpenCode returned an unrelated child session.".into());
                }
                let id = valid_id(child["id"].as_str().ok_or("Missing child session ID.")?)?;
                if stream.sessions.contains(id) || stream.sessions.len() >= 128 {
                    return Err("OpenCode's child sessions could not be restored safely.".into());
                }
                stream.sessions.insert(id.into());
                pending.push(id.to_owned());
            }
            let mut cursor = None;
            let mut seen = HashSet::new();
            loop {
                if pages >= 250 {
                    return Err("OpenCode's session history is too large to restore safely. Start a new task.".into());
                }
                let (messages, next) = self.messages(&session, 16, cursor.as_deref()).await?;
                stream.exclude_history(&messages, &session)?;
                pages += 1;
                let Some(next) = next else { break };
                if !seen.insert(next.clone()) {
                    return Err(
                        "OpenCode's session history could not be paged safely. Start a new task."
                            .into(),
                    );
                }
                cursor = Some(next);
            }
        }
        Ok(())
    }

    fn request(&self, method: Method, route: &str) -> reqwest::RequestBuilder {
        let mut url = reqwest::Url::parse(&format!("{}{route}", self.connection.url))
            .expect("fixed local OpenCode URL");
        url.query_pairs_mut()
            .append_pair("directory", self.workspace);
        self.client
            .request(method, url)
            .basic_auth("jackalope", Some(&self.connection.password))
    }

    async fn json(
        &self,
        method: Method,
        route: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let timeout = if route == "/session"
            || route
                .strip_prefix("/session/")
                .is_some_and(|tail| !tail.contains('/'))
        {
            120
        } else {
            15
        };
        let mut request = self
            .request(method, route)
            .timeout(Duration::from_secs(timeout));
        if let Some(body) = body {
            request = request.json(&body);
        }
        self.response(request, route).await.map(|(body, _)| body)
    }

    async fn messages(
        &self,
        session: &str,
        limit: usize,
        before: Option<&str>,
    ) -> Result<(Value, Option<String>), String> {
        let route = format!("/session/{session}/message");
        let mut request = self
            .request(Method::GET, &route)
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "Invalid OpenCode history request.")?;
        request
            .url_mut()
            .query_pairs_mut()
            .append_pair("limit", &limit.to_string());
        if let Some(before) = before {
            request
                .url_mut()
                .query_pairs_mut()
                .append_pair("before", before);
        }
        self.response(
            reqwest::RequestBuilder::from_parts(self.client.clone(), request),
            &route,
        )
        .await
    }

    async fn response(
        &self,
        request: reqwest::RequestBuilder,
        route: &str,
    ) -> Result<(Value, Option<String>), String> {
        let mut response = request
            .send()
            .await
            .map_err(|error| if error.is_timeout() {
                format!("OpenCode did not finish {route} before the transport timeout. Check the selected runner's plugin and dependency setup.")
            } else {
                format!("Could not reach the task's OpenCode server for {route}.")
            })?;
        if !response.status().is_success() {
            return Err(format!(
                "OpenCode {route} returned HTTP {}.",
                response.status().as_u16()
            ));
        }
        let cursor = response
            .headers()
            .get("x-next-cursor")
            .map(|value| {
                value
                    .to_str()
                    .ok()
                    .filter(|text| !text.is_empty() && text.len() <= 4096)
                    .map(str::to_owned)
                    .ok_or("Invalid OpenCode history cursor.")
            })
            .transpose()?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Could not read the OpenCode response.")?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE {
                return Err("OpenCode's response exceeded the task transport limit.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Ok((Value::Null, cursor));
        }
        serde_json::from_slice(&bytes)
            .map(|body| (body, cursor))
            .map_err(|_| "OpenCode returned invalid JSON.".into())
    }

    async fn answer(
        &self,
        runtime: &TaskRuntime,
        run_id: &str,
        request: &Value,
        permission: bool,
    ) -> Result<(), String> {
        let id = valid_id(
            request["id"]
                .as_str()
                .ok_or("Missing OpenCode request ID.")?,
        )?;
        if permission {
            let text = format!(
                "OpenCode requests permission for this action:\n{}",
                json!({"permission":request["permission"],"patterns":request["patterns"],"details":request["metadata"]})
            );
            if text.len() > 6000 {
                return Err("OpenCode's permission request is too large to review safely. The action was not approved.".into());
            }
            let answer = wait_for_answer(
                runtime,
                run_id,
                text,
                vec!["Allow once".into(), "Deny".into()],
                "choice",
            )
            .await;
            let allow = answer.as_deref() == Some("Allow once");
            self.json(
                Method::POST,
                &format!("/permission/{id}/reply"),
                Some(json!({"reply":if allow {"once"} else {"reject"}})),
            )
            .await?;
            if !allow {
                return Err("OpenCode permission was denied or unanswered. Review the saved action before continuing.".into());
            }
        } else {
            let questions = request["questions"]
                .as_array()
                .filter(|q| !q.is_empty() && q.len() <= 8)
                .ok_or("Unsupported OpenCode question form.")?;
            let mut answers = Vec::new();
            for question in questions {
                let text = question["question"]
                    .as_str()
                    .filter(|s| s.len() <= 4000)
                    .ok_or("Invalid OpenCode question.")?;
                let options: Vec<_> = question["options"]
                    .as_array()
                    .ok_or("Invalid OpenCode choices.")?
                    .iter()
                    .map(|o| {
                        o["label"]
                            .as_str()
                            .filter(|s| s.len() <= 160)
                            .map(str::to_owned)
                            .ok_or("Invalid OpenCode choice.")
                    })
                    .collect::<Result<_, _>>()?;
                if options.len() > 8 {
                    return Err("OpenCode supplied too many choices.".into());
                }
                let descriptions = question["options"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter_map(|option| {
                        let description = option["description"].as_str()?.trim();
                        (!description.is_empty()).then(|| {
                            format!(
                                "{}: {}",
                                option["label"].as_str().unwrap_or(""),
                                description.chars().take(500).collect::<String>()
                            )
                        })
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                let multiple = question["multiple"] == true;
                let answer = wait_for_answer(
                    runtime,
                    run_id,
                    if descriptions.is_empty() {
                        text.into()
                    } else {
                        format!("{text}\n\n{descriptions}")
                    },
                    options.clone(),
                    if multiple { "multiChoice" } else { "choice" },
                )
                .await;
                let answer = answer
                    .ok_or("OpenCode's question was not answered. Continue the task when ready.")?;
                let selected: Vec<String> = if multiple {
                    serde_json::from_str(&answer).map_err(|_| "Invalid multiple-choice answer.")?
                } else {
                    vec![answer]
                };
                if selected.is_empty()
                    || (question["custom"] == false
                        && selected.iter().any(|s| !options.contains(s)))
                {
                    return Err("The answer did not match OpenCode's question choices.".into());
                }
                answers.push(selected);
            }
            self.json(
                Method::POST,
                &format!("/question/{id}/reply"),
                Some(json!({"answers":answers})),
            )
            .await?;
        }
        Ok(())
    }
}

async fn wait_for_answer(
    runtime: &TaskRuntime,
    run_id: &str,
    question: String,
    options: Vec<String>,
    input_type: &str,
) -> Option<String> {
    let prompt = crate::commands::harness::PendingUserPrompt {
        id: uuid::Uuid::new_v4().to_string(),
        run_id: run_id.into(),
        question,
        input_type: input_type.into(),
        options,
        default_value: None,
        status: "pending".into(),
        answer: None,
        created_at: Utc::now().to_rfc3339(),
        answered_at: None,
    };
    runtime.record_prompt(&prompt);
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(600) && runtime.is_running(run_id) {
        let answer = runtime
            .inner
            .lock()
            .unwrap()
            .runs
            .get(run_id)
            .and_then(|r| r.prompts.iter().find(|p| p.id == prompt.id))
            .and_then(|p| p.answer.clone());
        if answer.is_some() {
            return answer;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    None
}

#[derive(Default)]
struct Frames {
    bytes: Vec<u8>,
}
impl Frames {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, String> {
        self.bytes.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(end) = [
            self.bytes
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|p| (p, 2)),
            self.bytes
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .map(|p| (p, 4)),
        ]
        .into_iter()
        .flatten()
        .min()
        {
            if end.0 > MAX_RESPONSE {
                return Err("An OpenCode event exceeded the transport limit.".into());
            }
            let frame = String::from_utf8(self.bytes.drain(..end.0 + end.1).collect())
                .map_err(|_| "Invalid OpenCode event encoding.")?;
            let data = frame
                .lines()
                .filter_map(|l| l.strip_prefix("data:").map(str::trim_start))
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() {
                events
                    .push(serde_json::from_str(&data).map_err(|_| "Invalid OpenCode event JSON.")?);
            }
        }
        if self.bytes.len() > MAX_RESPONSE {
            return Err("An OpenCode event exceeded the transport limit.".into());
        }
        Ok(events)
    }
}

struct Stream {
    root: String,
    sessions: HashSet<String>,
    history: HashSet<String>,
    messages: HashSet<String>,
    tools: HashMap<String, String>,
    active: bool,
}
impl Stream {
    fn new(root: &str) -> Self {
        Self {
            root: root.into(),
            sessions: HashSet::from([root.into()]),
            history: HashSet::new(),
            messages: HashSet::new(),
            tools: HashMap::new(),
            active: false,
        }
    }
    fn owns(&self, session: Option<&str>) -> bool {
        session.is_some_and(|id| self.sessions.contains(id))
    }
    fn relevant(&self, event: &Value) -> bool {
        let props = &event["properties"];
        match event["type"].as_str().unwrap_or("") {
            "session.created" => self.owns(props["info"]["parentID"].as_str()),
            "message.updated" => {
                let info = &props["info"];
                self.owns(info["sessionID"].as_str())
                    && info["role"] == "assistant"
                    && !info["id"]
                        .as_str()
                        .is_some_and(|id| self.history.contains(id))
                    && (info["time"]["completed"].is_number()
                        || !info["error"].is_null()
                        || !info["id"]
                            .as_str()
                            .is_some_and(|id| self.messages.contains(id)))
            }
            "message.part.updated" => {
                let part = &props["part"];
                self.owns(part["sessionID"].as_str())
                    && part["messageID"]
                        .as_str()
                        .is_some_and(|id| !self.history.contains(id))
                    && match part["type"].as_str().unwrap_or("") {
                        "tool" => part["id"].as_str().is_none_or(|id| {
                            self.tools.get(id).is_none_or(|status| {
                                Some(status.as_str()) != part["state"]["status"].as_str()
                            })
                        }),
                        "text" => part["sessionID"] == self.root && part["time"]["end"].is_number(),
                        _ => false,
                    }
            }
            "session.error" => props["sessionID"] == self.root,
            "session.status" => {
                props["sessionID"] == self.root && props["status"]["type"] == "idle" && self.active
            }
            _ => false,
        }
    }
    fn exclude_history(&mut self, messages: &Value, session: &str) -> Result<(), String> {
        for message in messages
            .as_array()
            .ok_or("Invalid OpenCode session history.")?
        {
            if !self.sessions.contains(session) || message["info"]["sessionID"] != session {
                return Err("OpenCode returned another session's history.".into());
            }
            self.history.insert(
                valid_id(
                    message["info"]["id"]
                        .as_str()
                        .ok_or("Missing history message ID.")?,
                )?
                .into(),
            );
        }
        Ok(())
    }
    fn consume(&mut self, run: &mut TaskRun, event: &Value) -> Result<bool, String> {
        let props = &event["properties"];
        match event["type"].as_str().unwrap_or("") {
            "session.created" if self.owns(props["info"]["parentID"].as_str()) => {
                if self.sessions.len() >= 128 {
                    return Err("OpenCode exceeded the supported child-session limit.".into());
                }
                self.sessions.insert(
                    valid_id(
                        props["info"]["id"]
                            .as_str()
                            .ok_or("Missing child session ID.")?,
                    )?
                    .into(),
                );
            }
            "message.updated" => {
                let info = &props["info"];
                if !self.owns(info["sessionID"].as_str()) || info["role"] != "assistant" {
                    return Ok(false);
                }
                let id = valid_id(info["id"].as_str().ok_or("Missing OpenCode message ID.")?)?;
                if self.history.contains(id) {
                    return Ok(false);
                }
                if self.messages.len() >= 4000 && !self.messages.contains(id) {
                    return Err("OpenCode exceeded the task message limit.".into());
                }
                self.messages.insert(id.into());
                self.active |= info["sessionID"] == self.root;
                if info["time"]["completed"].is_number() {
                    let model = info["providerID"]
                        .as_str()
                        .zip(info["modelID"].as_str())
                        .map(|(p, m)| format!("{p}/{m}"));
                    if info["sessionID"] == self.root {
                        if let Some(model) = &model {
                            run.model = Some(model.clone());
                        }
                    }
                    let before = run.usage_observations.len();
                    consume_adapter_event(run, &json!({"type":"step_finish","part":{"id":id,"tokens":info["tokens"],"cost":info["cost"]}}).to_string(), "opencode");
                    if run.usage_observations.len() > before {
                        let observation = run.usage_observations.last_mut().unwrap();
                        observation.model = model;
                        observation.session_id = info["sessionID"].as_str().map(str::to_owned);
                    }
                }
                if info["sessionID"] == self.root && !info["error"].is_null() {
                    consume_adapter_event(
                        run,
                        &json!({"type":"error","error":info["error"]}).to_string(),
                        "opencode",
                    );
                    return Err(run.error.clone().unwrap_or("OpenCode failed.".into()));
                }
            }
            "message.part.updated" => {
                let part = &props["part"];
                if !self.owns(part["sessionID"].as_str())
                    || part["messageID"]
                        .as_str()
                        .is_none_or(|id| self.history.contains(id))
                {
                    return Ok(false);
                }
                if part["type"] == "tool" {
                    let id = valid_id(part["id"].as_str().ok_or("Missing OpenCode tool ID.")?)?;
                    let status = part["state"]["status"].as_str().unwrap_or("");
                    if self.tools.len() >= 4000 && !self.tools.contains_key(id) {
                        return Err("OpenCode exceeded the task tool limit.".into());
                    }
                    if self.tools.get(id).is_none_or(|old| old != status) {
                        self.tools.insert(id.into(), status.into());
                        consume_adapter_event(
                            run,
                            &json!({"type":"tool_use","part":part}).to_string(),
                            "opencode",
                        );
                    }
                } else if part["type"] == "text"
                    && part["sessionID"] == self.root
                    && part["time"]["end"].is_number()
                {
                    if let Some(text) = part["text"].as_str() {
                        activity(run, text);
                    }
                }
            }
            "session.error" if props["sessionID"] == self.root => {
                consume_adapter_event(
                    run,
                    &json!({"type":"error","error":props["error"]}).to_string(),
                    "opencode",
                );
                return Err(run.error.clone().unwrap_or("OpenCode failed.".into()));
            }
            "session.status"
                if props["sessionID"] == self.root
                    && props["status"]["type"] == "idle"
                    && self.active =>
            {
                return Ok(true)
            }
            _ => {}
        }
        Ok(false)
    }
    fn finish(&self, messages: &Value) -> Result<String, String> {
        let messages = messages
            .as_array()
            .ok_or("Invalid final OpenCode messages.")?;
        let last = messages
            .iter()
            .rev()
            .find(|m| {
                m["info"]["role"] == "assistant"
                    && m["info"]["sessionID"] == self.root
                    && m["info"]["id"]
                        .as_str()
                        .is_some_and(|id| self.messages.contains(id))
            })
            .ok_or("OpenCode returned no new assistant response.")?;
        let info = &last["info"];
        if !info["time"]["completed"].is_number()
            || !info["error"].is_null()
            || info["finish"] != "stop"
        {
            return Err("OpenCode did not finish the turn successfully. Inspect the saved work before continuing.".into());
        }
        let text = last["parts"]
            .as_array()
            .ok_or("Invalid OpenCode final parts.")?
            .iter()
            .filter(|p| p["type"] == "text" && p["ignored"] != true)
            .filter_map(|p| p["text"].as_str())
            .collect::<Vec<_>>()
            .join("\n");
        if text.trim().is_empty() {
            return Err("OpenCode finished without a final answer.".into());
        }
        Ok(text.chars().take(120_000).collect())
    }
}

#[cfg(test)]
mod tests;
