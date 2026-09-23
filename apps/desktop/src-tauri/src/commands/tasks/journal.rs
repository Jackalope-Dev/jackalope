use super::*;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc,
};

const LIMIT: usize = 8_000_000;
const COMPACT_BYTES: u64 = 1_000_000;

#[derive(Serialize, Deserialize)]
struct Entry {
    sequence: u64,
    fields: serde_json::Map<String, Value>,
    append: serde_json::Map<String, Value>,
}

enum Message {
    Write(Request),
    Output {
        id: String,
        fields: serde_json::Map<String, Value>,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Flush(mpsc::Sender<()>),
}

struct Request {
    run: TaskRun,
    checkpoint: bool,
    reply: mpsc::Sender<Result<(), String>>,
}

#[derive(Clone)]
pub(super) struct Writer {
    worker: Arc<Worker>,
    pub revision: Arc<AtomicU64>,
    versions: Arc<Mutex<HashMap<String, u64>>>,
    errors: Arc<Mutex<HashMap<String, String>>>,
    signals: tokio::sync::watch::Sender<u64>,
}

struct Worker {
    sender: Option<mpsc::Sender<Message>>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

struct Current {
    value: Value,
    sequence: u64,
    bytes: u64,
    snapshot_bytes: usize,
}

impl Writer {
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        let (sender, receiver) = mpsc::channel::<Message>();
        let errors = Arc::new(Mutex::new(HashMap::new()));
        let worker_errors = errors.clone();
        let thread = std::thread::Builder::new()
            .name("task-history".into())
            .spawn(move || {
                let mut current = HashMap::<String, Current>::new();
                for message in receiver {
                    let (id, result, reply) = match message {
                        Message::Write(request) => {
                            let id = request.run.id.clone();
                            let result =
                                write(&directory, request.run, request.checkpoint, &mut current);
                            (id, result, request.reply)
                        }
                        Message::Output { id, fields, reply } => {
                            let result = write_output(&directory, &id, fields, &mut current);
                            (id, result, reply)
                        }
                        Message::Flush(reply) => {
                            let _ = reply.send(());
                            continue;
                        }
                    };
                    let mut errors = worker_errors.lock().unwrap();
                    if let Err(error) = &result {
                        current.remove(&id);
                        errors.insert(id, format!("History could not be saved: {error}"));
                    } else {
                        errors.remove(&id);
                    }
                    drop(errors);
                    let _ = reply.send(result);
                }
            })
            .map_err(|error| error.to_string())?;
        Ok(Self {
            worker: Arc::new(Worker {
                sender: Some(sender),
                thread: Some(thread),
            }),
            errors,
            revision: Arc::new(AtomicU64::new(0)),
            versions: Default::default(),
            signals: tokio::sync::watch::channel(0).0,
        })
    }

    pub fn changed(&self, id: &str) {
        let mut versions = self.versions.lock().unwrap();
        let revision = self.revision.fetch_add(1, Ordering::SeqCst) + 1;
        versions.insert(id.into(), revision);
        self.signals.send_replace(revision);
    }

    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<u64> {
        self.signals.subscribe()
    }

    pub fn version(&self, id: &str) -> u64 {
        self.versions.lock().unwrap().get(id).copied().unwrap_or(0)
    }

    pub fn error(&self, id: &str) -> Option<String> {
        self.errors.lock().unwrap().get(id).cloned()
    }

    pub fn submit(
        &self,
        run: TaskRun,
        checkpoint: bool,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        let (reply, receive) = mpsc::channel();
        self.changed(&run.id);
        self.worker
            .sender
            .as_ref()
            .unwrap()
            .send(Message::Write(Request {
                run,
                checkpoint,
                reply,
            }))
            .map_err(|_| "History writer stopped.".to_string())?;
        Ok(receive)
    }

    pub fn submit_output(
        &self,
        run: &TaskRun,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        if self.error(&run.id).is_some() || run.persistence_error.is_some() {
            return self.submit(run.clone(), true);
        }
        if !valid_id(&run.id) || run.details_omitted {
            return Err("Only complete task output can be saved.".into());
        }
        let fields = output_fields(run)?;
        let (reply, receive) = mpsc::channel();
        self.changed(&run.id);
        self.worker
            .sender
            .as_ref()
            .unwrap()
            .send(Message::Output {
                id: run.id.clone(),
                fields,
                reply,
            })
            .map_err(|_| "History writer stopped.".to_string())?;
        Ok(receive)
    }

    pub fn flush(&self) -> Result<(), String> {
        let (send, receive) = mpsc::channel();
        self.worker
            .sender
            .as_ref()
            .unwrap()
            .send(Message::Flush(send))
            .map_err(|_| "History writer stopped.".to_string())?;
        receive
            .recv()
            .map_err(|_| "History writer stopped before saving.".to_string())
    }

    pub fn wait(receive: mpsc::Receiver<Result<(), String>>) -> Result<(), String> {
        receive
            .recv()
            .map_err(|_| "History writer stopped before saving.".to_string())?
    }
}

fn sequence(value: &Value) -> u64 {
    value
        .get("journalSequence")
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

pub(super) fn read(path: &Path) -> Result<Vec<u8>, String> {
    let (bytes, warning) = recover(path)?;
    if let Some(warning) = warning {
        return Err(warning);
    }
    Ok(bytes)
}

pub(super) fn recover(path: &Path) -> Result<(Vec<u8>, Option<String>), String> {
    let bytes = crate::commands::history::read_bounded(path, LIMIT as u64)?;
    let journal = path.with_extension("journal");
    if !journal.exists() {
        return Ok((bytes, None));
    }
    let mut value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let records = crate::commands::history::read_bounded(&journal, (LIMIT * 2) as u64)?;
    let mut warning = None;
    for line in records.split_inclusive(|byte| *byte == b'\n') {
        let result = (|| -> Result<(), String> {
            if line.last() != Some(&b'\n') {
                return Err("An unfinished task journal update was preserved.".into());
            }
            let entry: Entry = serde_json::from_slice(line)
                .map_err(|e| format!("Task journal could not be recovered: {e}"))?;
            if entry.sequence <= sequence(&value) {
                return Ok(());
            }
            if Some(entry.sequence) != sequence(&value).checked_add(1) {
                return Err("Task journal has a missing update.".into());
            }
            let mut candidate = value.clone();
            let object = candidate
                .as_object_mut()
                .ok_or("Invalid task journal snapshot.")?;
            for (key, field) in entry.fields {
                object.insert(key, field);
            }
            for (key, suffix) in entry.append {
                let target = object
                    .get(&key)
                    .and_then(Value::as_str)
                    .ok_or("Invalid task journal append.")?;
                let suffix = suffix.as_str().ok_or("Invalid task journal text.")?;
                if target.len() + suffix.len() > LIMIT {
                    return Err("Task journal text exceeds the history size limit.".into());
                }
                let mut text = target.to_owned();
                text.push_str(suffix);
                object.insert(key, Value::String(text));
            }
            object.insert("journalSequence".into(), entry.sequence.into());
            value = candidate;
            Ok(())
        })();
        if let Err(error) = result {
            warning = Some(error);
            break;
        }
    }
    let bytes = serde_json::to_vec(&value).map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("Recovered task exceeds the history size limit.".into());
    }
    Ok((bytes, warning))
}

fn write(
    directory: &Path,
    mut run: TaskRun,
    checkpoint: bool,
    current: &mut HashMap<String, Current>,
) -> Result<(), String> {
    if !valid_id(&run.id) || run.details_omitted {
        return Err("Only a complete task record with a valid identifier can be saved.".into());
    }
    run.persistence_error = None;
    let path = directory.join(format!("{}.json", run.id));
    let journal = path.with_extension("journal");
    if !path.exists() && journal.exists() {
        return Err(
            "A task journal has no snapshot. Preserve it before restoring this task.".into(),
        );
    }
    if checkpoint && !journal.exists() {
        #[derive(Serialize)]
        struct Snapshot<'a> {
            #[serde(flatten)]
            run: &'a TaskRun,
            #[serde(rename = "journalSequence")]
            sequence: u64,
        }
        let bytes = serde_json::to_vec(&Snapshot {
            run: &run,
            sequence: 0,
        })
        .map_err(|e| e.to_string())?;
        if bytes.len() > LIMIT {
            return Err("This task exceeds the history size limit. Save a recovery copy before closing Jackalope.".into());
        }
        crate::commands::history::write_atomic(&path, &bytes)?;
        current.remove(&run.id);
        return Ok(());
    }
    let mut next = serde_json::to_value(&run).map_err(|e| e.to_string())?;
    let mut preserve_journal = false;
    if !current.contains_key(&run.id) && path.exists() {
        let (bytes, warning) = recover(&path)?;
        if let Some(warning) = warning {
            if !checkpoint {
                return Err(warning);
            }
            preserve_journal = true;
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        current.insert(
            run.id.clone(),
            Current {
                snapshot_bytes: serde_json::to_vec(&value).map_err(|e| e.to_string())?.len(),
                sequence: sequence(&value),
                value,
                bytes: std::fs::metadata(&journal).map(|m| m.len()).unwrap_or(0),
            },
        );
    }
    let previous = current.get(&run.id);
    let seq = previous
        .map(|entry| entry.sequence)
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("Task journal sequence is exhausted.")?;
    next["journalSequence"] = seq.into();
    let full = serde_json::to_vec(&next).map_err(|e| e.to_string())?;
    if full.len() > LIMIT {
        return Err("This task exceeds the history size limit. Save a recovery copy before closing Jackalope.".into());
    }
    if checkpoint
        || previous.is_none()
        || previous.is_some_and(|entry| entry.bytes >= COMPACT_BYTES)
    {
        crate::commands::history::write_atomic(&path, &full)?;
        if journal.exists() {
            if preserve_journal {
                std::fs::rename(
                    &journal,
                    path.with_extension(format!("journal-{}.corrupt", uuid::Uuid::new_v4())),
                )
                .map_err(|e| e.to_string())?;
            } else {
                std::fs::remove_file(&journal).map_err(|e| e.to_string())?;
            }
        }
        current.remove(&run.id);
        if !checkpoint {
            current.insert(
                run.id,
                Current {
                    snapshot_bytes: full.len(),
                    value: next,
                    sequence: seq,
                    bytes: 0,
                },
            );
        }
        return Ok(());
    }
    let previous = previous.unwrap();
    let mut entry = Entry {
        sequence: seq,
        fields: Default::default(),
        append: Default::default(),
    };
    for (key, value) in next.as_object().unwrap() {
        if key == "journalSequence" || previous.value.get(key) == Some(value) {
            continue;
        }
        if let (Some(old), Some(new)) = (
            previous.value.get(key).and_then(Value::as_str),
            value.as_str(),
        ) {
            if let Some(suffix) = new.strip_prefix(old) {
                entry
                    .append
                    .insert(key.clone(), Value::String(suffix.into()));
                continue;
            }
        }
        entry.fields.insert(key.clone(), value.clone());
    }
    if entry.fields.is_empty() && entry.append.is_empty() {
        return Ok(());
    }
    let mut bytes = serde_json::to_vec(&entry).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&journal)
        .map_err(|e| e.to_string())?;
    let old_length = file.metadata().map_err(|e| e.to_string())?.len();
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = file.set_len(old_length);
        return Err(error.to_string());
    }
    current.insert(
        run.id,
        Current {
            snapshot_bytes: full.len(),
            value: next,
            sequence: seq,
            bytes: old_length + bytes.len() as u64,
        },
    );
    Ok(())
}

// Streaming adapters and verification progress may change these fields. Lifecycle and
// coordination changes use full checkpoints, ordered through the same writer.
fn output_fields(run: &TaskRun) -> Result<serde_json::Map<String, Value>, String> {
    let mut fields = serde_json::Map::new();
    macro_rules! field {
        ($name:literal, $value:ident) => {
            fields.insert(
                $name.into(),
                serde_json::to_value(&run.$value).map_err(|e| e.to_string())?,
            );
        };
    }
    field!("result", result);
    field!("model", model);
    field!("sessionId", session_id);
    field!("activity", activity);
    field!("diagnostics", diagnostics);
    field!("error", error);
    field!("usage", usage);
    field!("usageObservations", usage_observations);
    field!("quotaFailure", quota_failure);
    field!("efficiency", efficiency);
    field!("progress", progress);
    field!("validationSteps", validation_steps);
    field!("screenshots", screenshots);
    fields.insert("persistenceError".into(), Value::Null);
    Ok(fields)
}

fn write_output(
    directory: &Path,
    id: &str,
    mut fields: serde_json::Map<String, Value>,
    current: &mut HashMap<String, Current>,
) -> Result<(), String> {
    let path = directory.join(format!("{id}.json"));
    let journal = path.with_extension("journal");
    if !current.contains_key(id) {
        let (bytes, warning) = recover(&path)?;
        if let Some(warning) = warning {
            return Err(warning);
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        current.insert(
            id.into(),
            Current {
                sequence: sequence(&value),
                snapshot_bytes: serde_json::to_vec(&value).map_err(|e| e.to_string())?.len(),
                value,
                bytes: std::fs::metadata(&journal).map(|m| m.len()).unwrap_or(0),
            },
        );
    }
    let previous = current.get_mut(id).unwrap();
    let seq = previous
        .sequence
        .checked_add(1)
        .ok_or("Task journal sequence is exhausted.")?;
    fields.insert("journalSequence".into(), seq.into());
    let mut entry = Entry {
        sequence: seq,
        fields: Default::default(),
        append: Default::default(),
    };
    let mut size = previous.snapshot_bytes;
    for (key, value) in &fields {
        let old = previous.value.get(key);
        if old == Some(value) {
            continue;
        }
        if let (Some(old), Some(new)) = (old.and_then(Value::as_str), value.as_str()) {
            if let Some(suffix) = new.strip_prefix(old) {
                size += serde_json::to_vec(suffix).map_err(|e| e.to_string())?.len() - 2;
                entry.append.insert(key.clone(), suffix.into());
                continue;
            }
        }
        let new_bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?.len();
        if let Some(old) = old {
            size = size
                .checked_sub(serde_json::to_vec(old).map_err(|e| e.to_string())?.len())
                .ok_or("Invalid task journal size.")?;
        } else {
            size += serde_json::to_vec(key).map_err(|e| e.to_string())?.len() + 2;
        }
        size += new_bytes;
        if key == "journalSequence" {
            continue;
        }
        entry.fields.insert(key.clone(), value.clone());
    }
    if size > LIMIT {
        return Err("This task exceeds the history size limit. Save a recovery copy before closing Jackalope.".into());
    }
    if entry.fields.is_empty() && entry.append.is_empty() {
        return Ok(());
    }
    let mut bytes = serde_json::to_vec(&entry).map_err(|e| e.to_string())?;
    bytes.push(b'\n');
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&journal)
        .map_err(|e| e.to_string())?;
    let old_length = file.metadata().map_err(|e| e.to_string())?.len();
    if let Err(error) = file.write_all(&bytes).and_then(|_| file.sync_all()) {
        let _ = file.set_len(old_length);
        return Err(error.to_string());
    }
    previous
        .value
        .as_object_mut()
        .ok_or("Invalid task journal snapshot.")?
        .extend(fields);
    previous.sequence = seq;
    previous.snapshot_bytes = size;
    previous.bytes = old_length + bytes.len() as u64;
    if previous.bytes >= COMPACT_BYTES {
        let full = serde_json::to_vec(&previous.value).map_err(|e| e.to_string())?;
        crate::commands::history::write_atomic(&path, &full)?;
        drop(file);
        std::fs::remove_file(&journal).map_err(|e| e.to_string())?;
        previous.bytes = 0;
    }
    Ok(())
}
