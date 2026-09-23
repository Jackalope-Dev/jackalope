use serde_json::{json, Map, Value};

pub(super) struct Field {
    key: String,
    question: String,
    choices: Vec<(String, String)>,
    multiple: bool,
}

pub(super) fn fields(params: &Value) -> Result<Vec<Field>, ()> {
    if params["mode"] != "form" || params["requestedSchema"]["type"] != "object" {
        return Err(());
    }
    let schema = &params["requestedSchema"];
    let properties = schema["properties"].as_object().ok_or(())?;
    if properties.is_empty() || properties.len() > 16 {
        return Err(());
    }
    if schema["required"].as_array().is_some_and(|keys| {
        keys.iter()
            .any(|key| key.as_str().is_none_or(|key| !properties.contains_key(key)))
    }) {
        return Err(());
    }
    let mut fields = Vec::new();
    for (key, property) in properties {
        let multiple = property["type"] == "array";
        let choices = if multiple {
            if property["minItems"].as_u64().is_some_and(|n| n > 1)
                || property.get("maxItems").is_some()
            {
                return Err(());
            }
            &property["items"]["anyOf"]
        } else if property["type"] == "string" {
            &property["oneOf"]
        } else {
            return Err(());
        };
        let choices = choices
            .as_array()
            .filter(|choices| !choices.is_empty() && choices.len() <= 32)
            .ok_or(())?;
        let mut options = Vec::new();
        for (index, option) in choices.iter().enumerate() {
            let value = option["const"]
                .as_str()
                .filter(|value| !value.is_empty() && value.len() <= 1000)
                .ok_or(())?;
            let title = option["title"].as_str().unwrap_or(value);
            let description = option["description"].as_str().unwrap_or("");
            options.push((
                value.into(),
                format!(
                    "{}. {}{}",
                    index + 1,
                    title.chars().take(160).collect::<String>(),
                    if description.is_empty() {
                        String::new()
                    } else {
                        format!(" — {}", description.chars().take(200).collect::<String>())
                    }
                ),
            ));
        }
        let question = format!(
            "{}\n{}\n{}",
            params["message"]
                .as_str()
                .unwrap_or("Kimi needs your input"),
            property["title"].as_str().unwrap_or(key),
            property["description"].as_str().unwrap_or("")
        )
        .chars()
        .take(6000)
        .collect();
        if serde_json::to_string(&options.iter().map(|(_, label)| label).collect::<Vec<_>>())
            .map_err(|_| ())?
            .len()
            > 4000
        {
            return Err(());
        }
        fields.push(Field {
            key: key.clone(),
            question,
            choices: options,
            multiple,
        });
    }
    Ok(fields)
}

pub(super) fn answer(
    params: &Value,
    mut ask: impl FnMut(String, Vec<String>, bool) -> Option<String>,
) -> Value {
    let Ok(fields) = fields(params) else {
        return json!({"action":"cancel"});
    };
    let mut content = Map::new();
    for field in fields {
        let labels = field
            .choices
            .iter()
            .map(|(_, label)| label.clone())
            .collect();
        let Some(answer) = ask(field.question, labels, field.multiple) else {
            return json!({"action":"cancel"});
        };
        let selected = if field.multiple {
            let Ok(values) = serde_json::from_str::<Vec<String>>(&answer) else {
                return json!({"action":"cancel"});
            };
            if values.is_empty()
                || values
                    .iter()
                    .any(|value| !field.choices.iter().any(|(_, label)| label == value))
            {
                return json!({"action":"cancel"});
            }
            json!(field
                .choices
                .iter()
                .filter(|(_, label)| values.contains(label))
                .map(|(value, _)| value)
                .collect::<Vec<_>>())
        } else {
            let Some((value, _)) = field.choices.iter().find(|(_, label)| label == &answer) else {
                return json!({"action":"cancel"});
            };
            json!(value)
        };
        content.insert(field.key, selected);
    }
    json!({"action":"accept","content":content})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kimi_form_preserves_all_questions_and_multiple_choices_without_defaults() {
        let params = json!({"mode":"form","requestedSchema":{"type":"object","required":["q0","q1"],"properties":{"q0":{"type":"string","oneOf":[{"const":"one","title":"One"},{"const":"two","title":"Two"}]},"q1":{"type":"array","minItems":1,"items":{"anyOf":[{"const":"A"},{"const":"B"}]}}}}});
        let result = answer(&params, |_, options, multiple| {
            Some(if multiple {
                serde_json::to_string(&options).unwrap()
            } else {
                options[1].clone()
            })
        });
        assert_eq!(
            result,
            json!({"action":"accept","content":{"q0":"two","q1":["A","B"]}})
        );
        assert_eq!(answer(&params, |_, _, _| None)["action"], "cancel");
        assert_eq!(
            answer(&params, |_, _, _| Some("invented".into()))["action"],
            "cancel"
        );
        let mut bad = params;
        bad["requestedSchema"]["properties"]["q1"]["type"] = json!("object");
        let mut asked = false;
        assert_eq!(
            answer(&bad, |_, _, _| {
                asked = true;
                None
            })["action"],
            "cancel"
        );
        assert!(!asked);
    }
}
