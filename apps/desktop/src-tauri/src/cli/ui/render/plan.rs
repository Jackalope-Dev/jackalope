//! The pinned plan panel: in the changes panel's place while a plan is open.
//! It is the terminal's approval gate: highlighted assumptions, the task
//! graph, which task covers each criterion, the recommended shape, and
//! progress once the plan runs.

use super::menus::frame_block;
use crate::brand;
use crate::protocol::PlanView;
use crate::ui::App;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

fn state_style(state: &str) -> Style {
    Style::default().fg(match state {
        "checked" | "merged" | "done" | "check-passed" | "human-accepted" => brand::success(),
        "needs-attention" | "check-failed" => brand::danger(),
        "running" | "agent-claimed" => brand::accent(),
        _ => brand::muted(),
    })
}

/// The panel's lines; kept apart from drawing so it can be tested.
pub fn lines(view: &PlanView) -> Vec<Line<'static>> {
    let muted = Style::default().fg(brand::muted());
    let bold = Style::default().add_modifier(Modifier::BOLD);
    let heading = |text: &str| Line::styled(text.to_string(), bold.fg(brand::accent()));
    let mut lines = vec![Line::from(vec![
        Span::styled(view.title.clone(), bold),
        Span::styled(
            format!("  {} · r{}", view.status, view.revision.unwrap_or_default()),
            muted,
        ),
    ])];
    if view.planning {
        lines.push(Line::styled(
            "Exploring read-only and interviewing you…",
            Style::default().fg(brand::accent()),
        ));
    }
    if let Some(error) = &view.error {
        lines.push(Line::styled(
            error.clone(),
            Style::default().fg(brand::danger()),
        ));
    }
    if view.revision.is_none() {
        return lines;
    }
    lines.push(Line::from(vec![
        Span::styled("Recommended ", muted),
        Span::styled(view.shape.clone(), bold),
        Span::styled(
            match (view.workers, view.shape_reason.is_empty()) {
                (0, true) => String::new(),
                (0, false) => format!(" · {}", view.shape_reason),
                (workers, true) => format!(" · ~{workers} workers"),
                (workers, false) => format!(" · ~{workers} workers · {}", view.shape_reason),
            },
            muted,
        ),
    ]));
    if ["draft", "approved"].contains(&view.status.as_str()) {
        match (view.verification.as_deref(), &view.check) {
            (Some("review"), _) => {
                lines.push(Line::styled(
                    "No automatic check: results are reviewed but not test-verified",
                    Style::default().fg(brand::warning()),
                ));
                lines.push(Line::styled(
                    "Add a check command in the app's Project settings",
                    muted,
                ));
            }
            (Some("criteria"), Some(check)) => {
                lines.push(Line::styled(
                    format!("Checked with the plan's test criteria: {check}"),
                    muted,
                ));
            }
            (_, Some(check)) => {
                lines.push(Line::styled(format!("Checked with {check}"), muted));
            }
            _ => {}
        }
    }
    if !view.changed.is_empty() {
        lines.push(Line::styled(
            format!("Changed: {}", view.changed.join(", ")),
            muted,
        ));
    }
    let pending: Vec<_> = view
        .deviations
        .iter()
        .filter(|deviation| deviation.status == "pending")
        .collect();
    for deviation in &pending {
        lines.push(Line::styled(
            format!("Deviation · {}", deviation.summary),
            Style::default().fg(brand::danger()),
        ));
    }
    if !pending.is_empty() {
        lines.push(Line::styled(
            "Enter or /deviation to decide · dependent work is paused",
            muted,
        ));
    }
    if let Some(progress) = &view.progress {
        lines.push(Line::styled(
            progress.clone(),
            Style::default().fg(brand::accent()),
        ));
    }
    if !view.assumptions.is_empty() {
        lines.push(Line::default());
        lines.push(heading("Assumptions"));
        // Facts the planner checked in the code need less scrutiny than its choices.
        for assumption in &view.assumptions {
            let mark = if crate::planning::checked(assumption) {
                Span::styled("✓ ", Style::default().fg(brand::success()))
            } else {
                Span::styled("! ", Style::default().fg(brand::warning()))
            };
            lines.push(Line::from(vec![mark, Span::raw(assumption.clone())]));
        }
    }
    lines.push(Line::default());
    lines.push(heading("Tasks"));
    for task in &view.tasks {
        let mut spans = vec![
            Span::styled(format!("{} ", task.key), bold),
            Span::raw(task.title.clone()),
        ];
        if !task.depends_on.is_empty() {
            spans.push(Span::styled(
                format!("  ← {}", task.depends_on.join(", ")),
                muted,
            ));
        }
        if task.parallel {
            spans.push(Span::styled("  [P]", muted));
        }
        if !task.state.is_empty() {
            spans.push(Span::styled(
                format!("  {}", task.state),
                state_style(&task.state),
            ));
        }
        lines.push(Line::from(spans));
    }
    lines.push(Line::default());
    lines.push(heading("Acceptance criteria"));
    for criterion in &view.criteria {
        let covered: Vec<&str> = view
            .tasks
            .iter()
            .filter(|task| task.covers.contains(&criterion.id))
            .map(|task| task.key.as_str())
            .collect();
        lines.push(Line::from(vec![
            Span::styled(format!("{} ", criterion.id), bold),
            Span::styled(format!("[{}] ", criterion.verify), muted),
            Span::raw(criterion.text.clone()),
        ]));
        let by = if covered.is_empty() {
            "not covered by a task".to_string()
        } else {
            format!("by {}", covered.join(", "))
        };
        lines.push(Line::from(vec![
            Span::styled(format!("    {by} · "), muted),
            Span::styled(criterion.state.clone(), state_style(&criterion.state)),
        ]));
    }
    lines
}

pub fn draw(frame: &mut Frame, app: &App, area: Rect) {
    let muted = Style::default().fg(brand::muted());
    let Some(view) = app.plan_view() else {
        return;
    };
    let hint = match view.status.as_str() {
        "draft" | "approved" => " /approve · /revise · Ctrl+G edit · /export ",
        "running" => " /replan · /export · /plan hides ",
        _ => " /plan hides ",
    };
    let block = frame_block(
        Span::styled(
            " Plan ",
            Style::default()
                .fg(brand::accent())
                .add_modifier(Modifier::BOLD),
        ),
        muted,
        None,
    )
    .title_bottom(Line::styled(hint, muted));
    let inner = block.inner(area);
    frame.render_widget(block, area);
    if inner.height < 2 || inner.width < 12 {
        return;
    }
    frame.render_widget(
        Paragraph::new(lines(view)).wrap(Wrap { trim: false }),
        inner,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{PlanCriterion, PlanDeviation, PlanTask};

    fn text(lines: &[Line]) -> String {
        lines
            .iter()
            .map(|line| {
                line.spans
                    .iter()
                    .map(|span| span.content.as_ref())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn the_gate_shows_assumptions_graph_coverage_and_deviations() {
        let view = PlanView {
            id: "p".into(),
            title: "Add CSV export".into(),
            status: "draft".into(),
            revision: Some(2),
            shape: "subtasks".into(),
            shape_reason: "Two separate files".into(),
            workers: 2,
            assumptions: vec![
                "Under 10,000 rows".into(),
                "Checked: Reports render in src/report.ts — evidence: src/report.ts:12".into(),
            ],
            tasks: vec![
                PlanTask {
                    key: "csv".into(),
                    title: "Serialize".into(),
                    covers: vec!["AC-1".into()],
                    ..Default::default()
                },
                PlanTask {
                    key: "button".into(),
                    title: "Button".into(),
                    depends_on: vec!["csv".into()],
                    parallel: true,
                    state: "running".into(),
                    ..Default::default()
                },
            ],
            criteria: vec![
                PlanCriterion {
                    id: "AC-1".into(),
                    verify: "test".into(),
                    text: "Quotes are escaped".into(),
                    state: "check-passed".into(),
                },
                PlanCriterion {
                    id: "AC-2".into(),
                    verify: "manual".into(),
                    text: "Downloads".into(),
                    state: "unassessed".into(),
                },
            ],
            deviations: vec![PlanDeviation {
                id: "d".into(),
                kind: "declared".into(),
                summary: "Needs an API route".into(),
                status: "pending".into(),
                ..Default::default()
            }],
            changed: vec!["Assumptions".into()],
            ..Default::default()
        };
        let shown = text(&lines(&view));
        assert!(shown.contains("Recommended subtasks · ~2 workers · Two separate files"));
        assert!(shown.contains("! Under 10,000 rows"));
        assert!(shown.contains("✓ Checked: Reports render in src/report.ts"));
        assert!(shown.contains("button Button  ← csv  [P]  running"));
        assert!(shown.contains("by csv · check-passed"));
        assert!(shown.contains("not covered by a task · unassessed"));
        assert!(shown.contains("Deviation · Needs an API route"));
        assert!(shown.contains("Changed: Assumptions"));
        let drafting = PlanView {
            title: "Plan".into(),
            planning: true,
            ..Default::default()
        };
        assert!(text(&lines(&drafting)).contains("interviewing you"));
        let unchecked = PlanView {
            verification: Some("review".into()),
            ..view.clone()
        };
        assert!(text(&lines(&unchecked)).contains("No automatic check"));
        let criteria = PlanView {
            verification: Some("criteria".into()),
            check: Some("pnpm test csv".into()),
            ..view
        };
        assert!(text(&lines(&criteria)).contains("test criteria: pnpm test csv"));
    }
}
