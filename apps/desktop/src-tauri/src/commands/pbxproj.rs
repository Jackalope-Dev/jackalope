//! Three-way merges of Xcode project files (`project.pbxproj`).
//!
//! Xcode writes the project as an OpenStep property list whose `objects`
//! dictionary is grouped into `/* Begin <isa> section */` blocks, one object per
//! 24-character ID. Adding a file touches four places at once (a build file, a
//! file reference, a group's `children` and a build phase's `files`), so two
//! branches that each add a file conflict as text although they never touch the
//! same object entry. The merge here works object by object: an object only one
//! side changed is taken whole with its original text, an object both sides
//! changed is merged key by key, and ordered ID lists (`children`, `files`,
//! `targets`, `buildPhases`, `packageProductDependencies`, ...) keep the base
//! order and apply both sides' insertions and removals. Unchanged objects keep
//! their exact bytes; an object both sides changed is written in Xcode's own
//! layout. A scalar both sides changed differently, an object one side deleted
//! and the other changed, or a reference to an object the merge removed is a
//! conflict, and the caller keeps Git's textual result.

use std::collections::{HashMap, HashSet};

/// Whether `path` names an Xcode project file.
pub(super) fn is_project_file(path: &str) -> bool {
    path.ends_with(".pbxproj")
}

/// Something both sides changed incompatibly.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct Conflict {
    /// The object's ID, or empty for the file as a whole.
    pub id: String,
    /// The name Xcode writes beside the ID, such as `ContentView.swift in Sources`.
    pub name: Option<String>,
    pub reason: String,
}

impl Conflict {
    fn file(reason: impl Into<String>) -> Self {
        Conflict {
            id: String::new(),
            name: None,
            reason: reason.into(),
        }
    }

    /// `ID (name): reason`, or the reason alone for the whole file.
    pub(super) fn describe(&self) -> String {
        match (&self.id[..], &self.name) {
            ("", _) => self.reason.clone(),
            (id, Some(name)) => format!("{id} ({name}): {}", self.reason),
            (id, None) => format!("{id}: {}", self.reason),
        }
    }
}

/// `ours` and `theirs` merged against `base`, or every conflict found. A file
/// that is not in Xcode's layout is reported as one conflict.
pub(super) fn merge(base: &str, ours: &str, theirs: &str) -> Result<String, Vec<Conflict>> {
    if ours == theirs || base == theirs {
        return Ok(ours.to_string());
    }
    if base == ours {
        return Ok(theirs.to_string());
    }
    let read = |text: &str| {
        Document::parse(text).map_err(|error| {
            vec![Conflict::file(format!(
                "Not an Xcode project file: {error}"
            ))]
        })
    };
    let (base, ours, theirs) = (read(base)?, read(ours)?, read(theirs)?);
    let mut conflicts = vec![];
    let head = pick(&base.head, &ours.head, &theirs.head).cloned();
    let tail = pick(&base.tail, &ours.tail, &theirs.tail).cloned();
    if head.is_none() || tail.is_none() {
        conflicts.push(Conflict::file(
            "Both sides changed the project's top-level settings.",
        ));
    }
    let objects = merge_objects(&base, &ours, &theirs, &mut conflicts);
    if !conflicts.is_empty() {
        return Err(conflicts);
    }
    let known: HashSet<&str> = [&base, &ours, &theirs]
        .iter()
        .flat_map(|document| document.objects().map(|object| object.id.as_str()))
        .collect();
    let present: HashSet<&str> = objects.iter().map(|object| object.id.as_str()).collect();
    for object in &objects {
        let mut missing = vec![];
        references(&Value::Dict(object.entries.clone()), &mut |value| {
            if known.contains(value)
                && !present.contains(value)
                && !missing.contains(&value.to_string())
            {
                missing.push(value.to_string());
            }
        });
        for id in missing {
            conflicts.push(Conflict {
                id: object.id.clone(),
                name: object.name(),
                reason: format!("Refers to {id}, which one side removed."),
            });
        }
    }
    let tail = tail.unwrap_or_default();
    for word in tail.split(|c: char| !c.is_ascii_alphanumeric()) {
        if known.contains(word) && !present.contains(word) {
            conflicts.push(Conflict::file(format!(
                "The project refers to {word}, which a side removed."
            )));
        }
    }
    if !conflicts.is_empty() {
        return Err(conflicts);
    }
    let sorted = [&base, &ours, &theirs]
        .iter()
        .all(|document| document.sorted());
    let text = Document::write(&head.unwrap_or_default(), &tail, objects, sorted);
    // The result must read back; anything else is a bug, reported rather than written.
    Document::parse(&text).map_err(|error| {
        vec![Conflict::file(format!(
            "The merged project could not be read back: {error}"
        ))]
    })?;
    Ok(text)
}

/// The usual three-way choice: whichever side changed, or either if both agree.
fn pick<'a, T: PartialEq>(base: &'a T, ours: &'a T, theirs: &'a T) -> Option<&'a T> {
    if ours == theirs || base == theirs {
        Some(ours)
    } else if base == ours {
        Some(theirs)
    } else {
        None
    }
}

#[derive(Clone, Debug, PartialEq)]
enum Value {
    /// A string as written, quotes included, with any `/* comment */` after it.
    Scalar {
        value: String,
        text: String,
    },
    Array(Vec<Value>),
    Dict(Vec<Entry>),
}

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    key: String,
    /// The key as written, with any comment after it.
    key_text: String,
    value: Value,
}

impl Value {
    /// What identifies an array element: an object ID or string without its comment.
    fn identity(&self) -> String {
        match self {
            Value::Scalar { value, .. } => value.clone(),
            other => {
                let mut text = String::new();
                write_inline(&mut text, other);
                text
            }
        }
    }

    /// The sort key of a group child: the name Xcode shows, else the value.
    fn display(&self) -> String {
        match self {
            Value::Scalar { value, text } => comment(text).unwrap_or(value).to_lowercase(),
            other => other.identity(),
        }
    }
}

fn comment(text: &str) -> Option<&str> {
    let start = text.find("/* ")? + 3;
    let end = text.rfind(" */")?;
    (end >= start).then(|| &text[start..end])
}

/// Every scalar value under `value`, keys excluded.
fn references(value: &Value, visit: &mut impl FnMut(&str)) {
    match value {
        Value::Scalar { value, .. } => visit(value),
        Value::Array(items) => items.iter().for_each(|item| references(item, visit)),
        Value::Dict(entries) => entries
            .iter()
            .for_each(|entry| references(&entry.value, visit)),
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Object {
    id: String,
    key_text: String,
    isa: String,
    entries: Vec<Entry>,
    /// The object exactly as it appears in the file, indentation and newline included.
    text: String,
    one_line: bool,
}

impl Object {
    fn name(&self) -> Option<String> {
        comment(&self.key_text).map(str::to_string)
    }
}

#[derive(Debug)]
struct Section {
    isa: String,
    objects: Vec<Object>,
}

#[derive(Debug)]
struct Document {
    /// Everything through the `objects = {` line.
    head: String,
    sections: Vec<Section>,
    /// Everything from the line that closes `objects`.
    tail: String,
}

const OBJECTS: &str = "\n\tobjects = {\n";
const OBJECTS_END: &str = "\t};\n";

impl Document {
    fn parse(text: &str) -> Result<Document, String> {
        if text.contains('\r') {
            return Err("it has Windows line endings".into());
        }
        let start = text.find(OBJECTS).ok_or("there is no objects dictionary")? + OBJECTS.len();
        let mut parser = Parser { text, pos: start };
        let mut sections = vec![];
        while let Some(rest) = parser.rest().strip_prefix("\n/* Begin ") {
            let line = rest.split_once('\n').map_or(rest, |(line, _)| line);
            let isa = line
                .strip_suffix(" section */")
                .filter(|isa| !isa.is_empty() && !isa.contains(char::is_whitespace))
                .ok_or("a section header is not in Xcode's form")?
                .to_string();
            parser.pos += "\n/* Begin ".len() + line.len() + 1;
            let end = format!("/* End {isa} section */\n");
            let mut objects: Vec<Object> = vec![];
            while !parser.rest().starts_with(&end) {
                let object = parser.object()?;
                if object.isa != isa {
                    return Err(format!("{} is filed under {isa}", object.id));
                }
                objects.push(object);
            }
            parser.pos += end.len();
            if objects.is_empty() {
                return Err(format!("the {isa} section is empty"));
            }
            sections.push(Section { isa, objects });
        }
        if !parser.rest().starts_with(OBJECTS_END) {
            return Err(format!(
                "unexpected text at byte {} of the objects dictionary",
                parser.pos
            ));
        }
        let document = Document {
            head: text[..start].to_string(),
            sections,
            tail: parser.rest().to_string(),
        };
        let mut seen = HashSet::new();
        if let Some(object) = document.objects().find(|object| !seen.insert(&object.id)) {
            return Err(format!("{} appears twice", object.id));
        }
        Ok(document)
    }

    fn objects(&self) -> impl Iterator<Item = &Object> {
        self.sections.iter().flat_map(|section| &section.objects)
    }

    /// Whether sections are in name order and objects in ID order, as Xcode writes them.
    fn sorted(&self) -> bool {
        self.sections
            .windows(2)
            .all(|pair| pair[0].isa < pair[1].isa)
            && self.sections.iter().all(|section| {
                section
                    .objects
                    .windows(2)
                    .all(|pair| pair[0].id < pair[1].id)
            })
    }

    /// The file for `objects` in their given order, grouped by section in order of
    /// first appearance, or sorted the way Xcode sorts when `sorted`.
    fn write(head: &str, tail: &str, mut objects: Vec<Object>, sorted: bool) -> String {
        if sorted {
            objects.sort_by(|a, b| (&a.isa, &a.id).cmp(&(&b.isa, &b.id)));
        }
        let mut order: Vec<&str> = vec![];
        for object in &objects {
            if !order.contains(&object.isa.as_str()) {
                order.push(&object.isa);
            }
        }
        let mut text = head.to_string();
        for isa in order {
            text.push_str(&format!("\n/* Begin {isa} section */\n"));
            for object in objects.iter().filter(|object| object.isa == isa) {
                text.push_str(&object.text);
            }
            text.push_str(&format!("/* End {isa} section */\n"));
        }
        text.push_str(tail);
        text
    }
}

struct Parser<'a> {
    text: &'a str,
    pos: usize,
}

impl Parser<'_> {
    fn rest(&self) -> &str {
        &self.text[self.pos..]
    }

    fn error(&self, what: &str) -> String {
        let line = self.text[..self.pos].matches('\n').count() + 1;
        format!("{what} on line {line}")
    }

    fn space(&mut self) {
        let rest = self.rest();
        self.pos += rest.len() - rest.trim_start().len();
    }

    fn expect(&mut self, token: char) -> Result<(), String> {
        self.space();
        if self.rest().starts_with(token) {
            self.pos += token.len_utf8();
            Ok(())
        } else {
            Err(self.error(&format!("expected '{token}'")))
        }
    }

    /// One object line, or several for a multi-line object, through its newline.
    fn object(&mut self) -> Result<Object, String> {
        let start = self.pos;
        if !self.rest().starts_with("\t\t") {
            return Err(self.error("an object is not indented as Xcode writes it"));
        }
        let (id, key_text) = self.scalar()?;
        self.expect('=')?;
        let Value::Dict(entries) = self.value()? else {
            return Err(self.error("an object is not a dictionary"));
        };
        self.expect(';')?;
        if !self.rest().starts_with('\n') {
            return Err(self.error("an object does not end its line"));
        }
        self.pos += 1;
        let isa = match entries.iter().find(|entry| entry.key == "isa") {
            Some(Entry {
                value: Value::Scalar { value, .. },
                ..
            }) => value.clone(),
            _ => return Err(format!("{id} has no isa")),
        };
        let text = self.text[start..self.pos].to_string();
        Ok(Object {
            one_line: text.matches('\n').count() == 1,
            id,
            key_text,
            isa,
            entries,
            text,
        })
    }

    fn value(&mut self) -> Result<Value, String> {
        self.space();
        match self.rest().chars().next() {
            Some('{') => {
                self.pos += 1;
                let mut entries = vec![];
                loop {
                    self.space();
                    if self.rest().starts_with('}') {
                        self.pos += 1;
                        return Ok(Value::Dict(entries));
                    }
                    let (key, key_text) = self.scalar()?;
                    self.expect('=')?;
                    let value = self.value()?;
                    self.expect(';')?;
                    if entries.iter().any(|entry: &Entry| entry.key == key) {
                        return Err(self.error(&format!("{key} appears twice")));
                    }
                    entries.push(Entry {
                        key,
                        key_text,
                        value,
                    });
                }
            }
            Some('(') => {
                self.pos += 1;
                let mut items = vec![];
                loop {
                    self.space();
                    if self.rest().starts_with(')') {
                        self.pos += 1;
                        return Ok(Value::Array(items));
                    }
                    items.push(self.value()?);
                    self.space();
                    if self.rest().starts_with(',') {
                        self.pos += 1;
                    } else if !self.rest().starts_with(')') {
                        return Err(self.error("expected ',' or ')'"));
                    }
                }
            }
            _ => {
                let (value, text) = self.scalar()?;
                Ok(Value::Scalar { value, text })
            }
        }
    }

    /// A quoted or bare string and any comment after it on the same line:
    /// the string as written and the whole text.
    fn scalar(&mut self) -> Result<(String, String), String> {
        self.space();
        let start = self.pos;
        let bytes = self.text.as_bytes();
        if bytes.get(self.pos) == Some(&b'"') {
            self.pos += 1;
            loop {
                match bytes.get(self.pos) {
                    None => return Err(self.error("a quoted string never ends")),
                    Some(b'\\') => self.pos += 2,
                    Some(b'"') => {
                        self.pos += 1;
                        break;
                    }
                    Some(_) => self.pos += 1,
                }
            }
        } else {
            while bytes
                .get(self.pos)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || b"_$+/:.-".contains(byte))
                && !self.rest().starts_with("/*")
                && !self.rest().starts_with("//")
            {
                self.pos += 1;
            }
            if self.pos == start {
                return Err(self.error("expected a value"));
            }
        }
        let value = self.text[start..self.pos].to_string();
        let after = self.rest();
        let gap = after.len() - after.trim_start_matches([' ', '\t']).len();
        if after[gap..].starts_with("/*") {
            let end = after[gap..]
                .find("*/")
                .ok_or_else(|| self.error("a comment never ends"))?;
            self.pos += gap + end + 2;
        }
        Ok((value, self.text[start..self.pos].to_string()))
    }
}

fn tabs(text: &mut String, depth: usize) {
    text.extend(std::iter::repeat_n('\t', depth));
}

/// `value` in the multi-line layout, its first line already indented to `depth`.
fn write_block(text: &mut String, value: &Value, depth: usize) {
    match value {
        Value::Scalar { text: written, .. } => text.push_str(written),
        Value::Array(items) => {
            text.push_str("(\n");
            for item in items {
                tabs(text, depth + 1);
                write_block(text, item, depth + 1);
                text.push_str(",\n");
            }
            tabs(text, depth);
            text.push(')');
        }
        Value::Dict(entries) => {
            text.push_str("{\n");
            for entry in entries {
                tabs(text, depth + 1);
                text.push_str(&entry.key_text);
                text.push_str(" = ");
                write_block(text, &entry.value, depth + 1);
                text.push_str(";\n");
            }
            tabs(text, depth);
            text.push('}');
        }
    }
}

/// `value` on one line, as Xcode writes build files and file references.
fn write_inline(text: &mut String, value: &Value) {
    match value {
        Value::Scalar { text: written, .. } => text.push_str(written),
        Value::Array(items) => {
            text.push('(');
            for item in items {
                write_inline(text, item);
                text.push_str(", ");
            }
            text.push(')');
        }
        Value::Dict(entries) => {
            text.push('{');
            for entry in entries {
                text.push_str(&entry.key_text);
                text.push_str(" = ");
                write_inline(text, &entry.value);
                text.push_str("; ");
            }
            text.push('}');
        }
    }
}

fn write_object(key_text: &str, entries: Vec<Entry>, one_line: bool) -> String {
    let mut text = String::from("\t\t");
    text.push_str(key_text);
    text.push_str(" = ");
    let value = Value::Dict(entries);
    if one_line {
        write_inline(&mut text, &value);
    } else {
        write_block(&mut text, &value, 2);
    }
    text.push_str(";\n");
    text
}

fn merge_objects(
    base: &Document,
    ours: &Document,
    theirs: &Document,
    conflicts: &mut Vec<Conflict>,
) -> Vec<Object> {
    let index = |document: &Document| -> HashMap<String, Object> {
        document
            .objects()
            .map(|object| (object.id.clone(), object.clone()))
            .collect()
    };
    let ids = |document: &Document| -> Vec<String> {
        document.objects().map(|object| object.id.clone()).collect()
    };
    let (b, o, t) = (index(base), index(ours), index(theirs));
    // Object order matters only for files not sorted the way Xcode sorts them.
    let order = order(&ids(base), &ids(ours), &ids(theirs)).unwrap_or_else(|| {
        let mut all = ids(ours);
        all.extend(ids(theirs).into_iter().filter(|id| !o.contains_key(id)));
        all
    });
    let mut merged = vec![];
    for id in every(order, [&ids(base), &ids(ours), &ids(theirs)]) {
        let (base, ours, theirs) = (b.get(&id), o.get(&id), t.get(&id));
        let texts = |object: Option<&Object>| object.map(|object| object.text.clone());
        if let Some(choice) = pick(&texts(base), &texts(ours), &texts(theirs)) {
            if choice.is_some() {
                let object = if texts(ours) == *choice { ours } else { theirs };
                merged.extend(object.cloned());
            }
            continue;
        }
        let (Some(ours), Some(theirs)) = (ours, theirs) else {
            let object = ours.or(theirs).or(base).expect("an object in some version");
            conflicts.push(Conflict {
                id,
                name: object.name(),
                reason: "One side deleted this object and the other changed it.".into(),
            });
            continue;
        };
        let mut found = vec![];
        let isa = pick(
            &base.map(|object| object.isa.clone()),
            &Some(ours.isa.clone()),
            &Some(theirs.isa.clone()),
        )
        .cloned()
        .flatten();
        let key_text = pick(
            &base.map(|object| object.key_text.clone()),
            &Some(ours.key_text.clone()),
            &Some(theirs.key_text.clone()),
        )
        .cloned()
        .flatten();
        if isa.is_none() {
            found.push("Both sides changed its type.".to_string());
        }
        if key_text.is_none() {
            found.push("Both sides renamed it differently.".to_string());
        }
        let entries = merge_entries(
            base.map_or(&[][..], |object| &object.entries),
            &ours.entries,
            &theirs.entries,
            "",
            &mut found,
        );
        if !found.is_empty() {
            conflicts.extend(found.into_iter().map(|reason| Conflict {
                id: id.clone(),
                name: ours.name(),
                reason,
            }));
            continue;
        }
        let key_text = key_text.unwrap_or_default();
        merged.push(Object {
            text: write_object(&key_text, entries.clone(), ours.one_line),
            id,
            key_text,
            isa: isa.unwrap_or_default(),
            entries,
            one_line: ours.one_line,
        });
    }
    merged
}

fn merge_entries(
    base: &[Entry],
    ours: &[Entry],
    theirs: &[Entry],
    path: &str,
    conflicts: &mut Vec<String>,
) -> Vec<Entry> {
    let keys = |entries: &[Entry]| -> Vec<String> {
        entries.iter().map(|entry| entry.key.clone()).collect()
    };
    let find =
        |entries: &[Entry], key: &str| entries.iter().find(|entry| entry.key == key).cloned();
    let Some(order) = order(&keys(base), &keys(ours), &keys(theirs)) else {
        conflicts.push(format!("Both sides reordered {}.", label(path, "its keys")));
        return vec![];
    };
    let mut merged = vec![];
    for key in every(order, [&keys(base), &keys(ours), &keys(theirs)]) {
        let (b, o, t) = (find(base, &key), find(ours, &key), find(theirs, &key));
        let at = if path.is_empty() {
            key.clone()
        } else {
            format!("{path}.{key}")
        };
        if let Some(choice) = pick(&b, &o, &t) {
            merged.extend(choice.clone());
            continue;
        }
        let (Some(o), Some(t)) = (o, t) else {
            conflicts.push(format!("One side removed {at} and the other changed it."));
            continue;
        };
        let key_text = pick(
            &b.as_ref().map(|entry| entry.key_text.clone()),
            &Some(o.key_text.clone()),
            &Some(t.key_text.clone()),
        )
        .cloned()
        .flatten()
        .unwrap_or(o.key_text.clone());
        let value = match (b.map(|entry| entry.value), o.value, t.value) {
            (base @ (None | Some(Value::Dict(_))), Value::Dict(ours), Value::Dict(theirs)) => {
                let base = match base {
                    Some(Value::Dict(entries)) => entries,
                    _ => vec![],
                };
                Value::Dict(merge_entries(&base, &ours, &theirs, &at, conflicts))
            }
            (base @ (None | Some(Value::Array(_))), Value::Array(ours), Value::Array(theirs)) => {
                let base = match base {
                    Some(Value::Array(items)) => items,
                    _ => vec![],
                };
                match merge_list(&base, &ours, &theirs, NAME_ORDERED.contains(&key.as_str())) {
                    Ok(items) => Value::Array(items),
                    Err(reason) => {
                        conflicts.push(format!("{at}: {reason}"));
                        continue;
                    }
                }
            }
            _ => {
                conflicts.push(format!("Both sides changed {at} differently."));
                continue;
            }
        };
        merged.push(Entry {
            key,
            key_text,
            value,
        });
    }
    merged
}

fn label(path: &str, fallback: &str) -> String {
    if path.is_empty() {
        fallback.to_string()
    } else {
        path.to_string()
    }
}

/// Lists whose order only affects display or has no effect on the build: a group's
/// children and a build phase's files.
const NAME_ORDERED: &[&str] = &["children", "files"];

/// An ordered list merged by element identity. A list in [`NAME_ORDERED`] stays
/// sorted by name when every version was.
fn merge_list(
    base: &[Value],
    ours: &[Value],
    theirs: &[Value],
    by_name: bool,
) -> Result<Vec<Value>, String> {
    let ids = |items: &[Value]| -> Result<Vec<String>, String> {
        let ids: Vec<String> = items.iter().map(Value::identity).collect();
        let unique: HashSet<&String> = ids.iter().collect();
        if unique.len() != ids.len() {
            return Err("the list repeats an entry, so it cannot be merged by entry.".into());
        }
        Ok(ids)
    };
    let (b, o, t) = (ids(base)?, ids(ours)?, ids(theirs)?);
    let order = order(&b, &o, &t).ok_or("both sides reordered the list.")?;
    let find = |items: &[Value], ids: &[String], id: &str| {
        ids.iter()
            .position(|other| other == id)
            .map(|at| items[at].clone())
    };
    let mut merged = vec![];
    for id in order {
        let item = match (find(ours, &o, &id), find(theirs, &t, &id)) {
            (Some(ours), Some(theirs)) => pick(&find(base, &b, &id), &Some(ours), &Some(theirs))
                .cloned()
                .flatten()
                .ok_or_else(|| format!("both sides changed {id} differently."))?,
            (Some(item), None) | (None, Some(item)) => item,
            (None, None) => unreachable!("merged order holds only present entries"),
        };
        merged.push(item);
    }
    let sorted = |items: &[Value]| {
        items
            .windows(2)
            .all(|pair| pair[0].display() <= pair[1].display())
    };
    if by_name && sorted(base) && sorted(ours) && sorted(theirs) {
        merged.sort_by_key(Value::display);
    }
    Ok(merged)
}

/// `order` followed by anything in `lists` it left out, so a removal one side
/// made is still checked against the other side's changes.
fn every(mut order: Vec<String>, lists: [&[String]; 3]) -> Vec<String> {
    let mut seen: HashSet<String> = order.iter().cloned().collect();
    for id in lists.into_iter().flatten() {
        if seen.insert(id.clone()) {
            order.push(id.clone());
        }
    }
    order
}

/// Three-way merge of unique, ordered identities. Elements either side removed
/// are dropped. One side's order is kept, the side that did not reorder the
/// shared elements, and the other side's additions are placed after the element
/// that precedes them there, following the first side's additions at the same
/// spot. `None` when both sides reordered shared elements differently.
fn order(base: &[String], ours: &[String], theirs: &[String]) -> Option<Vec<String>> {
    let base_set: HashSet<&String> = base.iter().collect();
    let (ours_set, theirs_set): (HashSet<&String>, HashSet<&String>) =
        (ours.iter().collect(), theirs.iter().collect());
    let kept = |list: &[String]| -> Vec<String> {
        list.iter()
            .filter(|id| base_set.contains(id) && ours_set.contains(id) && theirs_set.contains(id))
            .cloned()
            .collect()
    };
    let (kept_base, kept_ours, kept_theirs) = (kept(base), kept(ours), kept(theirs));
    let (primary, secondary) = if kept_theirs == kept_base || kept_ours == kept_theirs {
        (ours, theirs)
    } else if kept_ours == kept_base {
        (theirs, ours)
    } else {
        return None;
    };
    let secondary_set: HashSet<&String> = secondary.iter().collect();
    // Shared elements the other side removed go; the primary's own additions stay.
    let mut merged: Vec<String> = primary
        .iter()
        .filter(|id| !base_set.contains(id) || secondary_set.contains(id))
        .cloned()
        .collect();
    let mut placed: HashSet<String> = merged.iter().cloned().collect();
    let mut added_here: HashSet<String> = HashSet::new();
    let primary_added = |id: &String, added_here: &HashSet<String>| {
        !base_set.contains(id) && !added_here.contains(id)
    };
    for (position, id) in secondary.iter().enumerate() {
        if base_set.contains(id) || placed.contains(id) {
            continue;
        }
        let anchor = secondary[..position]
            .iter()
            .rev()
            .find_map(|before| merged.iter().position(|placed| placed == before));
        let mut at = anchor.map_or(0, |anchor| anchor + 1);
        while at < merged.len() && primary_added(&merged[at], &added_here) {
            at += 1;
        }
        merged.insert(at, id.clone());
        placed.insert(id.clone());
        added_here.insert(id.clone());
    }
    Some(merged)
}

#[cfg(test)]
#[path = "pbxproj/tests.rs"]
mod tests;
