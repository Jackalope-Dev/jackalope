//! Re-reading the conversation and workspace, off the interface thread.
//!
//! Change notifications arrive in bursts while agents work. Requests queue on
//! a channel and the refresher reads only the newest, so a burst costs one
//! round of reads and typing never waits on the host.

use super::feed::Tone;
use super::pickers::PickerKind;
use super::{App, Event};
use crate::connection::Connection;
use crate::protocol::{self, Handshake, Project, SessionSummary, SessionView};
use crate::{brand, git};
use std::sync::mpsc::{self, Sender};
use std::time::{Duration, Instant};

/// How stale the branch shown may get before it is read again.
const BRANCH_EVERY: Duration = Duration::from_secs(5);
/// How stale the changed-file list may get while notifications keep coming.
const CHANGES_EVERY: Duration = Duration::from_millis(1500);

pub struct Request {
    /// `App::context` when asked, so a stale answer can be dropped.
    context: u64,
    session: Option<String>,
    project: Project,
}

pub struct Snapshot {
    context: u64,
    sessions: Option<Vec<SessionSummary>>,
    projects: Option<Vec<Project>>,
    /// The project to show: the open conversation's, else the requested one.
    project: Project,
    branch: Option<Option<String>>,
    view: Option<SessionView>,
    /// The host could not be reached.
    lost: Option<String>,
    /// The host answered with an error about the conversation.
    problem: Option<String>,
    /// Files the open conversation's checkout changed, when it has one.
    changes: Option<Vec<git::FileChange>>,
}

/// The changed files last read, for which checkout and run state, and when.
#[derive(Default)]
pub struct ChangesCache {
    read: Option<(String, Instant, Option<Vec<git::FileChange>>)>,
}

impl ChangesCache {
    fn get(&mut self, key: &str, workspace: &str, project: &str) -> Option<Vec<git::FileChange>> {
        match &self.read {
            Some((seen, at, changes)) if seen == key && at.elapsed() < CHANGES_EVERY => {
                changes.clone()
            }
            _ => {
                let changes = git::changes(workspace, project);
                self.read = Some((key.to_string(), Instant::now(), changes.clone()));
                changes
            }
        }
    }
}

/// The branch last read, and for which checkout and when.
#[derive(Default)]
pub struct BranchCache {
    read: Option<(String, Instant, Option<String>)>,
}

impl BranchCache {
    fn get(&mut self, path: &str) -> Option<String> {
        match &self.read {
            Some((seen, at, branch)) if seen == path && at.elapsed() < BRANCH_EVERY => {
                branch.clone()
            }
            _ => {
                let branch = git::branch(path);
                self.read = Some((path.to_string(), Instant::now(), branch.clone()));
                branch
            }
        }
    }
}

pub fn spawn(handshake: Handshake, events: Sender<Event>) -> Sender<Request> {
    let (sender, requests) = mpsc::channel::<Request>();
    std::thread::spawn(move || {
        let mut connection = Connection::lazy(handshake);
        let mut branches = BranchCache::default();
        let mut changes = ChangesCache::default();
        while let Ok(mut request) = requests.recv() {
            // Only the newest request matters.
            while let Ok(newer) = requests.try_recv() {
                request = newer;
            }
            let snapshot = fetch(&mut connection, &mut branches, &mut changes, request);
            if events.send(Event::Snapshot(Box::new(snapshot))).is_err() {
                return;
            }
        }
    });
    sender
}

pub fn fetch(
    connection: &mut Connection,
    branches: &mut BranchCache,
    changes: &mut ChangesCache,
    request: Request,
) -> Snapshot {
    let mut snapshot = Snapshot {
        context: request.context,
        sessions: None,
        projects: None,
        project: request.project.clone(),
        branch: None,
        view: None,
        lost: None,
        problem: None,
        changes: None,
    };
    let sessions = match connection.sessions() {
        Ok(sessions) => sessions,
        Err(error) => {
            snapshot.lost = Some(error);
            return snapshot;
        }
    };
    let projects = connection.projects().unwrap_or_default();
    let project_id = request
        .session
        .as_ref()
        .and_then(|id| sessions.iter().find(|session| &session.id == id))
        .map_or(request.project.id.as_str(), |session| {
            session.project_id.as_str()
        });
    if let Some(project) = projects.iter().find(|project| project.id == project_id) {
        snapshot.project = project.clone();
    }
    snapshot.branch = Some(branches.get(&snapshot.project.path));
    if let Some(id) = &request.session {
        match connection.session(id) {
            Ok(view) => {
                let workspace = view
                    .workspace
                    .clone()
                    .filter(|path| !path.is_empty() && std::path::Path::new(path).is_dir())
                    .unwrap_or_else(|| snapshot.project.path.clone());
                // A run's status is part of the key so the list is re-read
                // once work settles, however recently it was read.
                let key = format!("{workspace}\n{:?}", view.status);
                snapshot.changes = Some(
                    changes
                        .get(&key, &workspace, &snapshot.project.path)
                        .unwrap_or_default(),
                );
                snapshot.view = Some(view);
            }
            Err(error) => snapshot.problem = Some(error),
        }
    }
    snapshot.sessions = Some(sessions);
    snapshot.projects = Some(projects);
    snapshot
}

impl App {
    fn refresh_request(&self) -> Request {
        Request {
            context: self.context,
            session: self.session.clone(),
            project: self.project.clone(),
        }
    }

    /// Asks the refresher to re-read what is on screen.
    pub(super) fn refresh(&mut self) {
        let _ = self.refresher.send(self.refresh_request());
    }

    /// Re-reads on this thread, for the first frame.
    pub(super) fn refresh_now(&mut self) {
        let request = self.refresh_request();
        let snapshot = fetch(
            &mut self.connection,
            &mut BranchCache::default(),
            &mut ChangesCache::default(),
            request,
        );
        self.apply(snapshot);
    }

    pub(super) fn apply(&mut self, snapshot: Snapshot) {
        if snapshot.context != self.context {
            return;
        }
        if let Some(lost) = snapshot.lost {
            self.offline = Some(lost);
            return;
        }
        if self.offline.take().is_some() {
            self.flash("Reconnected to Jackalope", Tone::Success);
        }
        if let Some(sessions) = snapshot.sessions {
            self.sessions = sessions;
        }
        if let Some(projects) = snapshot.projects {
            self.projects = projects;
        }
        let project = snapshot.project;
        if project.accent != self.project.accent || project.id != self.project.id {
            brand::set_accent(project.accent.as_deref());
        }
        self.project = project;
        if let Some(branch) = snapshot.branch {
            self.branch = branch;
        }
        match snapshot.problem {
            Some(problem) if self.problem.as_ref() != Some(&problem) => {
                self.note(problem.clone());
                self.problem = Some(problem);
            }
            Some(_) => {}
            None => self.problem = None,
        }
        if let Some(view) = snapshot.view {
            self.set_view(Some(view));
        }
        if let Some(changes) = snapshot.changes {
            self.set_changes(changes);
        }
        self.track_work();
        self.offer_question();
        if self.picker.as_ref().map(|picker| picker.kind) == Some(PickerKind::Sessions) {
            self.open_picker(PickerKind::Sessions);
        }
    }

    /// Notes when the current run was first seen working, for its elapsed time.
    fn track_work(&mut self) {
        let run = self
            .view
            .as_ref()
            .and_then(|view| view.run_id.clone())
            .filter(|_| self.working());
        match run {
            Some(run)
                if self
                    .work_started
                    .as_ref()
                    .is_none_or(|(seen, _)| *seen != run) =>
            {
                self.work_started = Some((run, Instant::now()));
            }
            Some(_) => {}
            None => self.work_started = None,
        }
        let progress = self.view.as_ref().filter(|_| self.working()).map(|view| {
            format!(
                "{:?}|{:?}|{:?}|{}|{}|{:?}",
                view.run_id,
                view.step,
                view.step_detail,
                view.result.len(),
                view.activity.len(),
                view.activity.last(),
            )
        });
        match progress {
            Some(progress)
                if self
                    .last_progress
                    .as_ref()
                    .is_none_or(|(seen, _)| *seen != progress) =>
            {
                self.last_progress = Some((progress, Instant::now()));
            }
            Some(_) => {}
            None => self.last_progress = None,
        }
    }

    /// Sends a request the user asked for, noting any error in the feed.
    pub(super) fn request(&mut self, request: protocol::Request) -> Option<protocol::Response> {
        match self.connection.send(&request) {
            Ok(protocol::Response::Error { message }) => {
                self.note(message);
                None
            }
            Ok(response) => Some(response),
            Err(error) => {
                self.note_tone(
                    format!("Lost contact with Jackalope: {error}"),
                    Tone::Danger,
                );
                None
            }
        }
    }
}
