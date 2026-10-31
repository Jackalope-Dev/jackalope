//! Accessibility snapshots with element refs. Resident Windows and macOS
//! helpers assign refs that stay stable while an element exists; other
//! helpers' trees get sequential refs here. Every snapshot records each ref's
//! role, name and window-relative bounds so element actions can be validated
//! and, when a platform lacks accessibility actions, sent as coordinates.

use serde_json::{json, Map, Value};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Element {
    pub role: String,
    pub name: String,
    pub bounds: Option<[i32; 4]>,
    pub protected: bool,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct RefTable {
    entries: HashMap<String, Element>,
}

pub(crate) fn valid_ref(value: &str) -> bool {
    value.len() >= 2
        && value.len() <= 8
        && value.starts_with('e')
        && value[1..].bytes().all(|b| b.is_ascii_digit())
        && !value[1..].starts_with('0')
}

fn bounds(value: &Value) -> Option<[i32; 4]> {
    let number = |v: &Value| {
        v.as_f64()
            .filter(|n| n.is_finite())
            .map(|n| n.round() as i32)
    };
    let parts = match value {
        Value::Array(items) if items.len() == 4 => [
            number(&items[0])?,
            number(&items[1])?,
            number(&items[2])?,
            number(&items[3])?,
        ],
        Value::Object(fields) => [
            number(fields.get("x")?)?,
            number(fields.get("y")?)?,
            number(fields.get("width")?)?,
            number(fields.get("height")?)?,
        ],
        _ => return None,
    };
    (parts[2] > 0 && parts[3] > 0).then_some(parts)
}

/// Normalizes a helper snapshot into `elements` with refs and array bounds,
/// returning the ref table. Accepts the older `controls` key and object bounds.
pub(crate) fn normalize(snapshot: &mut Value) -> RefTable {
    let items = snapshot
        .as_object_mut()
        .and_then(|fields| {
            fields
                .remove("elements")
                .or_else(|| fields.remove("controls"))
        })
        .and_then(|value| match value {
            Value::Array(items) => Some(items),
            _ => None,
        })
        .unwrap_or_default();
    let mut table = RefTable::default();
    let mut normalized = Vec::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        let Value::Object(mut fields) = item else {
            continue;
        };
        let reference = fields
            .get("ref")
            .and_then(Value::as_str)
            .filter(|value| valid_ref(value) && !table.entries.contains_key(*value))
            .map(str::to_owned)
            .unwrap_or_else(|| {
                let mut number = index + 1;
                while table.entries.contains_key(&format!("e{number}")) {
                    number += 1;
                }
                format!("e{number}")
            });
        let protected = fields.get("protected") == Some(&json!(true))
            || fields.get("password") == Some(&json!(true))
            || fields.get("role").and_then(Value::as_str) == Some("password");
        if protected {
            fields.insert("protected".into(), json!(true));
            fields.remove("value");
            fields.remove("description");
            fields.insert("name".into(), json!("[protected]"));
        }
        fields.remove("password");
        let rect = fields.get("bounds").and_then(bounds);
        fields.insert("bounds".into(), rect.map_or(Value::Null, |b| json!(b)));
        fields.insert("ref".into(), json!(reference));
        let text = |fields: &Map<String, Value>, key: &str| {
            fields
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        table.entries.insert(
            reference,
            Element {
                role: text(&fields, "role"),
                name: text(&fields, "name"),
                bounds: rect,
                protected,
            },
        );
        normalized.push(Value::Object(fields));
    }
    snapshot["elements"] = Value::Array(normalized);
    table
}

impl RefTable {
    /// Resolves a ref from this snapshot, rejecting unknown and protected elements.
    pub fn resolve(&self, reference: &str) -> Result<&Element, String> {
        if !valid_ref(reference) {
            return Err("Element refs look like e12. Use one from the latest snapshot.".into());
        }
        let element = self.entries.get(reference).ok_or_else(|| {
            format!("Element {reference} is not in the latest snapshot. Take a new snapshot.")
        })?;
        if element.protected {
            return Err("Password controls are protected. Enter secrets yourself.".into());
        }
        Ok(element)
    }

    /// The element's center relative to the captured window, for coordinate fallback.
    pub fn center(&self, reference: &str, area: Option<[i32; 4]>) -> Result<(i32, i32), String> {
        let element = self.resolve(reference)?;
        let [x, y, width, height] = element.bounds.ok_or(
            "This element has no on-screen bounds. Scroll it into view and take a new snapshot.",
        )?;
        let point = (x + width / 2, y + height / 2);
        if point.0 < 0
            || point.1 < 0
            || area.is_some_and(|[_, _, w, h]| point.0 >= w || point.1 >= h)
        {
            return Err("This element is outside the visible window area. Scroll it into view and take a new snapshot.".into());
        }
        Ok(point)
    }

    /// Finds the first element whose name or value contains `text`, ignoring case.
    pub fn find_text(snapshot: &Value, text: &str) -> Option<Value> {
        let needle = text.to_lowercase();
        snapshot["elements"].as_array()?.iter().find_map(|item| {
            let matches = ["name", "value", "description"].iter().any(|key| {
                item[*key]
                    .as_str()
                    .is_some_and(|value| value.to_lowercase().contains(&needle))
            });
            (matches && item["protected"] != true).then(|| item.clone())
        })
    }
}

/// Window bounds from a helper's snapshot (array on Windows, object elsewhere).
pub(crate) fn area(value: &Value) -> Option<[i32; 4]> {
    bounds(value)
}
