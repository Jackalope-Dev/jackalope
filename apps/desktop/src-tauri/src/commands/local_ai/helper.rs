use super::*;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperVerification {
    pub model: String,
    pub digest: String,
    pub inference_digest: String,
    pub elapsed_ms: u64,
}

fn alias(id: &str) -> String {
    format!("jackalope-helper-{}", id.replace(':', "-"))
}

pub(super) fn configure(config: &mut Value, id: &str) {
    config["small_model"] = json!(format!("{PROVIDER}/{id}"));
    config["provider"][PROVIDER]["models"][id] =
        json!({"id":alias(id),"name":id,"tool_call":false,"limit":{"context":8192,"output":512}});
}

pub(super) fn revalidate(
    installed: &Value,
    helper: Option<&HelperVerification>,
) -> Result<(), String> {
    if let Some(helper) = helper {
        if digest(installed, &helper.model).as_deref() != Some(&helper.digest)
            || digest(installed, &alias(&helper.model)).as_deref() != Some(&helper.inference_digest)
        {
            return Err("The title model changed. Check it again before connecting.".into());
        }
    }
    Ok(())
}

fn valid_response(value: &Value, marker: &str) -> bool {
    value["done"] == true
        && value["message"]["role"] == "assistant"
        && value["message"]
            .get("tool_calls")
            .is_none_or(|calls| calls.as_array().is_some_and(Vec::is_empty))
        && value["message"]["content"]
            .as_str()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .is_some_and(|answer| {
                answer.as_object().is_some_and(|fields| fields.len() == 1)
                    && answer["title"] == marker
            })
}

pub(super) async fn verify(
    id: &str,
    canceled: Arc<AtomicBool>,
) -> Result<HelperVerification, String> {
    model(id)?;
    let expected =
        digest(&tags().await?, id).ok_or("Install the title model before checking it.")?;
    let started = std::time::Instant::now();
    let operation = async {
        let prepared = response_json(client()?.post(format!("{ENDPOINT}/api/create"))
            .json(&json!({"model":alias(id),"from":id,"parameters":{"num_ctx":8192},"stream":false}))
            .timeout(Duration::from_secs(60)).send().await.map_err(|_| "Could not prepare the title model.")?).await?;
        if prepared["status"] != "success" {
            return Err("Could not prepare the title model.".into());
        }
        let inference_digest =
            digest(&tags().await?, &alias(id)).ok_or("The prepared title model is missing.")?;
        let marker = format!("Local check {}", &uuid::Uuid::new_v4().to_string()[..8]);
        let response = response_json(client()?.post(format!("{ENDPOINT}/api/chat"))
            .json(&json!({"model":alias(id),"stream":false,"think":false,"keep_alive":"2m",
                "options":{"num_ctx":8192,"num_predict":128,"temperature":0},
                "format":{"type":"object","properties":{"title":{"type":"string"}},"required":["title"],"additionalProperties":false},
                "messages":[{"role":"user","content":format!("Return a JSON object with only the title field. Copy this title exactly: {marker}")}] }))
            .timeout(Duration::from_secs(120)).send().await.map_err(|_| "The title model did not answer in time.")?).await?;
        if !valid_response(&response, &marker) {
            return Err("The title model did not pass its structured response check. Choose another model or use the coding model.".into());
        }
        let verified = HelperVerification {
            model: id.into(),
            digest: expected,
            inference_digest,
            elapsed_ms: started.elapsed().as_millis() as u64,
        };
        revalidate(&tags().await?, Some(&verified))?;
        Ok(verified)
    };
    tokio::select! {
        result = operation => result,
        _ = wait_canceled(canceled) => Err("Local check stopped.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn helper_is_separate_and_old_receipts_remain_readable() {
        let receipt: Verification = serde_json::from_value(json!({"model":"qwen3.5:9b","digest":"base","inferenceDigest":"prepared","elapsedMs":1,"checkedAt":"now"})).unwrap();
        assert!(receipt.helper.is_none());
        let mut config = verified_config(&receipt);
        configure(&mut config, "qwen3.5:4b");
        assert_eq!(config["model"], "jackalope-local/qwen3.5:9b");
        assert_eq!(config["small_model"], "jackalope-local/qwen3.5:4b");
        assert_eq!(
            config["provider"][PROVIDER]["models"]["qwen3.5:9b"]["limit"]["context"],
            65536
        );
        assert_eq!(
            config["provider"][PROVIDER]["models"]["qwen3.5:4b"]["limit"]["context"],
            8192
        );
    }

    #[test]
    fn check_rejects_extra_fields_incomplete_and_tool_responses() {
        let valid =
            json!({"done":true,"message":{"role":"assistant","content":"{\"title\":\"check\"}"}});
        assert!(valid_response(&valid, "check"));
        for invalid in [
            json!({"done":false,"message":valid["message"]}),
            json!({"done":true,"message":{"role":"assistant","tool_calls":[{}],"content":"{\"title\":\"check\"}"}}),
            json!({"done":true,"message":{"role":"assistant","content":"{\"title\":\"check\",\"extra\":1}"}}),
        ] {
            assert!(!valid_response(&invalid, "check"));
        }
        let helper = HelperVerification {
            model: "qwen3.5:4b".into(),
            digest: "base".into(),
            inference_digest: "prepared".into(),
            elapsed_ms: 1,
        };
        assert!(revalidate(&json!({"models":[]}), Some(&helper)).is_err());
    }
}
