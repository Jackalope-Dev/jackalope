use super::*;
use std::collections::BTreeMap;

#[derive(Deserialize, schemars::JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Rows {
    pub pointer: String,
    #[serde(default)]
    pub where_equals: BTreeMap<String, Value>,
    #[serde(default)]
    pub columns: Vec<String>,
    #[serde(default)]
    pub offset: usize,
    pub limit: Option<usize>,
    #[serde(default)]
    pub count_only: bool,
}

impl Rows {
    pub(super) fn validate(&self) -> Result<(), String> {
        let pointers = std::iter::once(&self.pointer)
            .chain(self.where_equals.keys())
            .chain(&self.columns);
        if self.where_equals.len() > 8
            || self.columns.len() > 16
            || self.offset > 100_000
            || self.limit.is_some_and(|limit| !(1..=256).contains(&limit))
            || pointers
                .into_iter()
                .any(|p| !p.starts_with('/') || p.len() > 512)
            || self.where_equals.values().any(|value| {
                value.is_array() || value.is_object() || value.to_string().len() > 1024
            })
        {
            return Err("Use bounded RFC 6901 row pointers, at most eight scalar equality filters, sixteen columns and 1-256 rows.".into());
        }
        Ok(())
    }

    pub(super) fn select(&self, value: &Value) -> Option<Value> {
        let rows = value.pointer(&self.pointer)?.as_array()?;
        let mut matches = Vec::new();
        for (index, row) in rows.iter().enumerate() {
            let mut keep = true;
            for (key, expected) in &self.where_equals {
                // Missing fields are not evidence of irrelevance.
                keep &= row.pointer(key)? == expected;
            }
            if keep {
                matches.push((index, row));
            }
        }
        let mut selected = Vec::new();
        if !self.count_only {
            for (index, row) in matches
                .iter()
                .skip(self.offset)
                .take(self.limit.unwrap_or(64))
            {
                let mut fields = serde_json::Map::new();
                for key in &self.columns {
                    fields.insert(key.clone(), row.pointer(key)?.clone());
                }
                selected.push(json!({"sourceIndex":index,"value":if fields.is_empty() {(*row).clone()} else {Value::Object(fields)}}));
            }
        }
        let next = self.offset.saturating_add(selected.len());
        Some(
            json!({"sourceRows":rows.len(),"matchedRows":matches.len(),"rows":selected,"countOnly":self.count_only,
            "nextOffset":if !self.count_only && next < matches.len() {Some(next)} else {None}}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_filters_keep_source_indices_counts_and_missing_evidence() {
        let input: Rows = serde_json::from_value(
            json!({"pointer":"/items","whereEquals":{"/ready":true},"columns":["/id"],"limit":1}),
        )
        .unwrap();
        input.validate().unwrap();
        let value =
            json!({"items":[{"id":1,"ready":false},{"id":2,"ready":true},{"id":3,"ready":true}]});
        let selected = input.select(&value).unwrap();
        assert_eq!(selected["rows"][0]["sourceIndex"], 1);
        assert_eq!(selected["rows"][0]["value"]["/id"], 2);
        assert_eq!(selected["matchedRows"], 2);
        assert_eq!(selected["nextOffset"], 1);
        assert!(input.select(&json!({"items":[{"id":1}]})).is_none());
        let count: Rows =
            serde_json::from_value(json!({"pointer":"/items","countOnly":true})).unwrap();
        assert_eq!(count.select(&value).unwrap()["matchedRows"], 3);
    }
}
