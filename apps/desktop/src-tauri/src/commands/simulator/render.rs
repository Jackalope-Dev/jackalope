//! The driver's snapshot JSON as the text an agent reads: one line per
//! element with its `@e` ref, bounded like browser snapshots.

use serde_json::Value;

/// The longest snapshot text returned.
pub(super) const LIMIT: usize = 40_000;

/// Element types an agent acts on, kept by interactive-only snapshots.
const INTERACTIVE: &[&str] = &[
    "button",
    "link",
    "textField",
    "secureTextField",
    "searchField",
    "textView",
    "switch",
    "toggle",
    "slider",
    "stepper",
    "segmentedControl",
    "picker",
    "pickerWheel",
    "datePicker",
    "cell",
    "tab",
    "menuItem",
    "checkBox",
    "radioButton",
    "popUpButton",
    "comboBox",
    "menuButton",
    "toolbarButton",
    "pageIndicator",
    "incrementArrow",
    "decrementArrow",
    "tableRow",
    "outlineRow",
    "colorWell",
];

/// Containers that only add depth when they have no text of their own.
const STRUCTURAL: &[&str] = &["other", "group", "window", "layoutArea", "layoutItem"];

#[derive(Clone, Debug, Default)]
pub(super) struct Options {
    pub interactive: bool,
    /// An identifier or label whose subtree is the whole snapshot.
    pub scope: Option<String>,
}

pub(super) struct Rendered {
    pub text: String,
    pub truncated: bool,
}

/// Renders a `/snapshot` answer.
pub(super) fn render(snapshot: &Value, options: &Options) -> Result<Rendered, String> {
    let tree = &snapshot["tree"];
    let root = match options.scope.as_deref().map(str::trim).filter(|scope| !scope.is_empty()) {
        Some(scope) => find(tree, scope).ok_or_else(|| {
            format!("No element has the identifier or label \"{scope}\". Take a snapshot without scope to see the screen.")
        })?,
        None => tree,
    };
    let mut out = Writer {
        text: String::new(),
        truncated: false,
        interactive: options.interactive,
    };
    let screen = &snapshot["screen"];
    out.line(&format!(
        "{} ({}, {}) screen {}x{} pt",
        tree["label"]
            .as_str()
            .filter(|label| !label.is_empty())
            .unwrap_or("App"),
        snapshot["bundleId"].as_str().unwrap_or("unknown"),
        snapshot["state"].as_str().unwrap_or("unknown"),
        screen[2].as_u64().unwrap_or(0),
        screen[3].as_u64().unwrap_or(0),
    ));
    if std::ptr::eq(root, tree) {
        for child in children(root) {
            out.node(child, 0, None);
        }
    } else {
        out.node(root, 0, None);
    }
    if let Some(alerts) = snapshot["alerts"]
        .as_array()
        .filter(|alerts| !alerts.is_empty())
    {
        out.line("System alerts (shown over the app):");
        for alert in alerts {
            out.node(alert, 0, None);
        }
    }
    if snapshot["truncated"] == true {
        out.truncated = true;
    }
    if out.truncated {
        out.text.push_str(
            "… The snapshot is truncated. Use scope or interactive to read less of the screen.\n",
        );
    }
    Ok(Rendered {
        text: out.text,
        truncated: out.truncated,
    })
}

fn children(node: &Value) -> impl Iterator<Item = &Value> {
    node["children"].as_array().into_iter().flatten()
}

fn text<'a>(node: &'a Value, key: &str) -> &'a str {
    node[key].as_str().unwrap_or("")
}

/// The first element whose identifier is `scope`, else whose label is, else
/// whose label contains it.
fn find<'a>(tree: &'a Value, scope: &str) -> Option<&'a Value> {
    fn walk<'a>(node: &'a Value, matches: &dyn Fn(&Value) -> bool) -> Option<&'a Value> {
        if matches(node) {
            return Some(node);
        }
        children(node).find_map(|child| walk(child, matches))
    }
    let lower = scope.to_lowercase();
    walk(tree, &|node| text(node, "id") == scope)
        .or_else(|| walk(tree, &|node| text(node, "label") == scope))
        .or_else(|| {
            walk(tree, &|node| {
                text(node, "label").to_lowercase().contains(&lower)
            })
        })
}

struct Writer {
    text: String,
    truncated: bool,
    interactive: bool,
}

impl Writer {
    fn line(&mut self, line: &str) -> bool {
        if self.truncated {
            return false;
        }
        if self.text.len() + line.len() + 1 > LIMIT - 200 {
            self.truncated = true;
            return false;
        }
        self.text.push_str(line);
        self.text.push('\n');
        true
    }

    /// Writes `node` and its children. Structural containers without text
    /// are skipped with their children kept at the same depth, and text that
    /// only repeats its parent's label is left out.
    fn node(&mut self, node: &Value, depth: usize, parent_label: Option<&str>) {
        if self.truncated {
            return;
        }
        let kind = text(node, "type");
        let label = text(node, "label");
        let shown = if self.interactive {
            INTERACTIVE.contains(&kind)
        } else {
            let bare =
                label.is_empty() && text(node, "id").is_empty() && text(node, "value").is_empty();
            let echo = kind == "staticText" && parent_label == Some(label) && !label.is_empty();
            !(bare && STRUCTURAL.contains(&kind)) && !echo
        };
        let mut next = depth;
        if shown {
            self.line(&format!(
                "{}- {}",
                "  ".repeat(depth.min(20)),
                describe(node)
            ));
            next = depth + 1;
        }
        if let Some(more) = node["more"].as_u64() {
            self.line(&format!(
                "{}… {more} more elements below this depth",
                "  ".repeat(next.min(20))
            ));
        }
        let inherited = if shown && !label.is_empty() {
            Some(label)
        } else {
            parent_label
        };
        for child in children(node) {
            self.node(child, next, inherited);
        }
    }
}

/// `button "General" @e12 id=… value="…" [disabled] (16,293 370x52)`.
fn describe(node: &Value) -> String {
    let mut line = text(node, "type").to_string();
    let label = text(node, "label");
    if !label.is_empty() {
        line.push_str(&format!(" {}", quoted(label)));
    }
    if let Some(reference) = node["ref"].as_str() {
        line.push_str(&format!(" @{reference}"));
    }
    let id = text(node, "id");
    if !id.is_empty() && id != label {
        line.push_str(&format!(" id={}", quoted(id)));
    }
    let value = text(node, "value");
    let placeholder = text(node, "placeholder");
    if !value.is_empty() && value != placeholder {
        line.push_str(&format!(" value={}", quoted(value)));
    }
    if !placeholder.is_empty() {
        line.push_str(&format!(" placeholder={}", quoted(placeholder)));
    }
    let flags: Vec<&str> = [
        ("disabled", "disabled"),
        ("selected", "selected"),
        ("focused", "focused"),
    ]
    .into_iter()
    .filter(|(key, _)| node[*key] == true)
    .map(|(_, flag)| flag)
    .collect();
    if !flags.is_empty() {
        line.push_str(&format!(" [{}]", flags.join(", ")));
    }
    if let Some(frame) = node["frame"].as_array().filter(|frame| frame.len() == 4) {
        let n = |i: usize| frame[i].as_i64().unwrap_or(0);
        line.push_str(&format!(" ({},{} {}x{})", n(0), n(1), n(2), n(3)));
    }
    line
}

fn quoted(text: &str) -> String {
    let flat: String = text
        .chars()
        .map(|ch| if ch.is_control() { ' ' } else { ch })
        .collect();
    format!("\"{}\"", flat.replace('"', "\\\""))
}
