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
                    let request = match message {
                        Message::Write(request) => request,
                        Message::Flush(reply) => {
                            let _ = reply.send(());
                            continue;
                        }
                    };
                    let id = request.run.id.clone();
                    let result = write(&directory, request.run, request.checkpoint, &mut current);
                    let mut errors = worker_errors.lock().unwrap();
                    if let Err(error) = &result {
                        current.remove(&id);
                        errors.insert(id, format!("History could not be saved: {error}"));
                    } else {
                        errors.remove(&id);
                    }
                    drop(errors);
                    let _ = request.reply.send(result);
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
            value: next,
            sequence: seq,
            bytes: old_length + bytes.len() as u64,
        },
    );
    Ok(())
}
