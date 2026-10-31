//! What a finished plan teaches: deviations that had to be accepted and
//! criteria that kept failing become reflection observations, which the
//! learned-lesson promotion gate accepts, merges or rejects.

use super::{
    artifact::PlanDocument,
    handoff::CriterionState,
    store::{PlanRecord, Store},
};
use crate::commands::{
    coordination::Coordinator,
    knowledge::learning::{self, Observation, ObservationKind},
};

/// Observation statements for a delivered plan. Each is phrased as a directive
/// so reflection can turn it into a lesson; the gate decides what is kept.
pub fn observations(
    record: &PlanRecord,
    doc: &PlanDocument,
    criteria: &[CriterionState],
) -> Vec<Observation> {
    let reference = format!("Plan {}", record.id);
    let mut found = vec![];
    for deviation in record
        .deviations
        .iter()
        .filter(|deviation| matches!(deviation.status.as_str(), "accepted" | "replan"))
    {
        found.push(format!(
            "Always confirm this while planning, because the approved plan had to change: {}",
            deviation.summary
        ));
    }
    for state in criteria
        .iter()
        .filter(|state| state.state == "check-failed")
    {
        if let Some(criterion) = doc.criterion(&state.id) {
            found.push(format!(
                "Always check early that {}, because it failed during delivery of {}",
                criterion.text, doc.title
            ));
        }
    }
    found
        .into_iter()
        .take(6)
        .map(|text| Observation {
            kind: ObservationKind::Statement,
            text: text.chars().take(600).collect(),
            reference: reference.clone(),
            run_id: None,
        })
        .collect()
}

/// Sends a finished plan's observations through the promotion gate once.
pub fn reflect(
    coordinator: &Coordinator,
    store: &Store,
    record: &PlanRecord,
    doc: &PlanDocument,
    criteria: &[CriterionState],
) {
    if record.reflected {
        return;
    }
    let observations = observations(record, doc, criteria);
    let knowledge = &coordinator.runtime.knowledge;
    if !observations.is_empty() {
        let result = knowledge
            .list(&record.project_id, &record.project_path)
            .and_then(|existing| {
                knowledge.promote(
                    &record.project_id,
                    &record.project_path,
                    learning::reflect(&observations, &existing),
                    "plan",
                )
            });
        if let Err(error) = result {
            eprintln!("Plan reflection was not recorded: {error}");
            return;
        }
    }
    let _ = store.update(&record.id, |saved| {
        saved.reflected = true;
        Ok(())
    });
}
