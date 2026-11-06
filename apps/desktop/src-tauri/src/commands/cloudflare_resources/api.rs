//! Cloudflare REST calls for each resource kind. Each `ensure_*` finds the resource
//! by name first and creates it only when it is missing, returning the ID bindings
//! use. Routes are relative to `/accounts/{account_id}`.

use super::{api_failure, error_code, error_detail, Failure, Kind, PostgresOrigin, Step};
use serde_json::{json, Value};

/// Pages read when listing resources to find one by name.
const MAX_PAGES: u32 = 20;
const PAGE_SIZE: usize = 100;
const MAX_RESPONSE: usize = 4_000_000;

pub(super) struct Api {
    /// `https://api.cloudflare.com/client/v4/accounts/{account_id}`, or a test server.
    pub root: String,
    pub account_id: String,
    pub token: String,
    pub oauth: bool,
    pub client: reqwest::Client,
}

fn ok(status: u16, body: &Value) -> bool {
    (200..300).contains(&status) && body["success"] == true
}

/// IDs and names go into request paths; anything else is refused.
fn path_safe(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && value != "."
        && value != ".."
}

fn text(value: &Value, fields: &[&str]) -> Option<String> {
    fields
        .iter()
        .find_map(|field| value[*field].as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
}

impl Api {
    pub async fn send(
        &self,
        method: reqwest::Method,
        route: &str,
        body: Option<&Value>,
    ) -> Result<(u16, Value), String> {
        let mut request = self
            .client
            .request(method, format!("{}{route}", self.root))
            .bearer_auth(&self.token);
        if let Some(body) = body {
            request = request.json(body);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| "Could not reach Cloudflare. Check your connection and retry.")?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "The Cloudflare response was interrupted. Retry.")?
        {
            if bytes.len() + chunk.len() > MAX_RESPONSE {
                return Err("Cloudflare returned an unexpectedly large response.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok((
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        ))
    }

    async fn call(
        &self,
        kind: Kind,
        method: reqwest::Method,
        route: &str,
        body: Option<&Value>,
    ) -> Result<(u16, Value), Failure> {
        self.send(method, route, body)
            .await
            .map_err(|message| Failure::new(Step::from(kind), message))
    }

    fn refused(&self, kind: Kind, status: u16, body: &Value) -> Failure {
        api_failure(kind, &self.account_id, status, body, self.oauth)
    }

    async fn expect(
        &self,
        kind: Kind,
        method: reqwest::Method,
        route: &str,
        body: Option<&Value>,
    ) -> Result<Value, Failure> {
        let (status, value) = self.call(kind, method, route, body).await?;
        if !ok(status, &value) {
            return Err(self.refused(kind, status, &value));
        }
        Ok(value)
    }

    /// The first item in a list response whose `name_field` is `name`. `paged`
    /// routes accept `page` and `per_page`; others return everything at once.
    async fn find(
        &self,
        kind: Kind,
        route: &str,
        paged: bool,
        name_field: &str,
        name: &str,
    ) -> Result<Option<Value>, Failure> {
        for page in 1..=MAX_PAGES {
            let target = if paged {
                let separator = if route.contains('?') { '&' } else { '?' };
                format!("{route}{separator}per_page={PAGE_SIZE}&page={page}")
            } else {
                route.to_owned()
            };
            let body = self
                .expect(kind, reqwest::Method::GET, &target, None)
                .await?;
            let items = body["result"].as_array().cloned().unwrap_or_default();
            if let Some(item) = items.iter().find(|item| item[name_field] == name) {
                return Ok(Some(item.clone()));
            }
            let last_page = match body["result_info"]["total_pages"].as_u64() {
                Some(total) => u64::from(page) >= total,
                None => items.len() < PAGE_SIZE,
            };
            if !paged || items.is_empty() || last_page {
                break;
            }
        }
        Ok(None)
    }

    async fn create(
        &self,
        kind: Kind,
        route: &str,
        body: &Value,
        id_fields: &[&str],
    ) -> Result<String, Failure> {
        let value = self
            .expect(kind, reqwest::Method::POST, route, Some(body))
            .await?;
        text(&value["result"], id_fields).ok_or_else(|| {
            Failure::new(
                Step::from(kind),
                format!(
                    "Cloudflare created {} but did not return its ID. Retry to pick it up.",
                    kind.label()
                ),
            )
        })
    }

    /// R2 buckets are addressed by name; `GET /r2/buckets/{name}` answers 404 (10006)
    /// when it does not exist, and creating one that exists in this account is 10004.
    pub async fn ensure_r2(&self, name: &str) -> Result<Option<String>, Failure> {
        let kind = Kind::R2;
        let (status, body) = self
            .call(
                kind,
                reqwest::Method::GET,
                &format!("/r2/buckets/{name}"),
                None,
            )
            .await?;
        if ok(status, &body) {
            return Ok(Some(name.into()));
        }
        if status != 404 && error_code(&body) != 10006 {
            return Err(self.refused(kind, status, &body));
        }
        let (status, body) = self
            .call(
                kind,
                reqwest::Method::POST,
                "/r2/buckets",
                Some(&json!({"name": name})),
            )
            .await?;
        if ok(status, &body) || error_code(&body) == 10004 {
            return Ok(Some(name.into()));
        }
        Err(self.refused(kind, status, &body))
    }

    pub async fn ensure_d1(&self, name: &str) -> Result<Option<String>, Failure> {
        let kind = Kind::D1;
        let route = format!("/d1/database?name={name}");
        if let Some(found) = self.find(kind, &route, true, "name", name).await? {
            if let Some(id) = text(&found, &["uuid"]) {
                return Ok(Some(id));
            }
        }
        self.create(kind, "/d1/database", &json!({"name": name}), &["uuid"])
            .await
            .map(Some)
    }

    pub async fn ensure_kv(&self, name: &str) -> Result<Option<String>, Failure> {
        let kind = Kind::Kv;
        let route = "/storage/kv/namespaces";
        if let Some(found) = self.find(kind, route, true, "title", name).await? {
            if let Some(id) = text(&found, &["id"]) {
                return Ok(Some(id));
            }
        }
        self.create(kind, route, &json!({"title": name}), &["id"])
            .await
            .map(Some)
    }

    pub async fn ensure_queue(&self, name: &str) -> Result<Option<String>, Failure> {
        let kind = Kind::Queue;
        let route = "/queues";
        if let Some(found) = self.find(kind, route, false, "queue_name", name).await? {
            if let Some(id) = text(&found, &["queue_id", "id"]) {
                return Ok(Some(id));
            }
        }
        self.create(
            kind,
            route,
            &json!({"queue_name": name}),
            &["queue_id", "id"],
        )
        .await
        .map(Some)
    }

    /// The connection string is needed only to create a config; an existing config
    /// with this name is reused as it is.
    pub async fn ensure_hyperdrive(
        &self,
        name: &str,
        origin: Option<&PostgresOrigin>,
    ) -> Result<Option<String>, Failure> {
        let kind = Kind::Hyperdrive;
        let route = "/hyperdrive/configs";
        if let Some(found) = self.find(kind, route, false, "name", name).await? {
            if let Some(id) = text(&found, &["id"]) {
                return Ok(Some(id));
            }
        }
        let origin = origin.ok_or_else(|| {
            Failure::new(
                Step::Hyperdrive,
                "Enter your Postgres connection string to create the Hyperdrive config.",
            )
        })?;
        let body = json!({
            "name": name,
            "origin": {
                "scheme": "postgres",
                "host": origin.host,
                "port": origin.port,
                "database": origin.database,
                "user": origin.user,
                "password": origin.password,
            },
        });
        self.create(kind, route, &body, &["id"])
            .await
            .map(Some)
            .map_err(|mut failure| {
                // Error details can quote the origin; never repeat the password.
                failure.message = failure.message.replace(&origin.password, "[redacted]");
                failure
            })
    }

    pub async fn ensure_turnstile(
        &self,
        name: &str,
        domains: &[String],
    ) -> Result<Option<String>, Failure> {
        let kind = Kind::Turnstile;
        let route = "/challenges/widgets";
        if let Some(found) = self.find(kind, route, true, "name", name).await? {
            if let Some(id) = text(&found, &["sitekey"]) {
                return Ok(Some(id));
            }
        }
        self.create(
            kind,
            route,
            &json!({"name": name, "domains": domains, "mode": "managed"}),
            &["sitekey"],
        )
        .await
        .map(Some)
    }

    /// The route that deletes a resource of `kind` with this ID.
    pub(super) fn delete_route(kind: Kind, id: &str) -> Option<String> {
        if !path_safe(id) {
            return None;
        }
        Some(match kind {
            Kind::R2 => format!("/r2/buckets/{id}"),
            Kind::D1 => format!("/d1/database/{id}"),
            Kind::Kv => format!("/storage/kv/namespaces/{id}"),
            Kind::Queue => format!("/queues/{id}"),
            Kind::Hyperdrive => format!("/hyperdrive/configs/{id}"),
            Kind::Turnstile => format!("/challenges/widgets/{id}"),
            Kind::DurableObjects | Kind::Workers => return None,
        })
    }

    /// Deletes the resource; one Cloudflare no longer has counts as deleted.
    /// R2 refuses buckets that still hold objects (10008).
    pub async fn delete(&self, kind: Kind, id: &str) -> Result<(), String> {
        let route = Self::delete_route(kind, id)
            .ok_or_else(|| format!("Jackalope cannot delete {} here.", kind.label()))?;
        let (status, body) = self.send(reqwest::Method::DELETE, &route, None).await?;
        let code = error_code(&body);
        if ok(status, &body) || status == 404 || matches!(code, 10006 | 10007) {
            return Ok(());
        }
        if kind == Kind::R2 && code == 10008 {
            return Err(format!(
                "R2 deletes only empty buckets. Empty {id} in the Cloudflare dashboard, then delete it again. Cloudflare said: {}",
                error_detail(&body)
            ));
        }
        Err(self.refused(kind, status, &body).message)
    }

    pub async fn turnstile_secret(&self, sitekey: &str) -> Result<String, String> {
        if !path_safe(sitekey) {
            return Err("The recorded Turnstile site key is not valid.".into());
        }
        let value = self
            .expect(
                Kind::Turnstile,
                reqwest::Method::GET,
                &format!("/challenges/widgets/{sitekey}"),
                None,
            )
            .await
            .map_err(|failure| failure.message)?;
        text(&value["result"], &["secret"])
            .ok_or_else(|| "Cloudflare did not return the Turnstile secret key.".into())
    }
}
