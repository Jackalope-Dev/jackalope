use super::*;
use std::collections::HashMap;

fn feature(name: &str, page: &str, sources: &[&str]) -> Feature {
    Feature {
        name: name.into(),
        page: page.into(),
        sources: sources.iter().map(|s| s.to_string()).collect(),
        ..Default::default()
    }
}

fn paths(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

#[test]
fn globs_match_folders_wildcards_and_alternatives() {
    assert!(glob_matches("src/settings/**", "src/settings/Profile.tsx"));
    assert!(glob_matches("src/settings/**", "src/settings/deep/a.ts"));
    assert!(glob_matches("src/settings", "src/settings/deep/a.ts"));
    assert!(!glob_matches("src/settings", "src/settings-old/a.ts"));
    assert!(glob_matches("src/**/*.css", "src/a/b/c.css"));
    assert!(glob_matches("src/**/*.css", "src/c.css"));
    assert!(!glob_matches("src/*.css", "src/a/c.css"));
    assert!(glob_matches("./SRC/App.tsx", "src/app.tsx"));
    assert!(glob_matches("app/{billing,plans}/**", "app/plans/page.tsx"));
    assert!(glob_matches("src/page?.ts", "src/page1.ts"));
    assert!(!glob_matches("../outside/**", "outside/a.ts"));
    assert!(!glob_matches("", "anything"));
}

#[test]
fn changed_sources_choose_pages_and_every_entry_labels_its_page() {
    let map = usable(&[
        feature("Billing", "/settings/billing/", &["src/billing/**"]),
        feature("Profile", "/settings/profile", &["src/profile/**"]),
        Feature {
            route_file: Some("app/help/page.tsx".into()),
            ..feature("Help", "/help", &[])
        },
        feature("Invoices", "/settings/billing", &["src/invoices/**"]),
        feature("", "/unnamed", &["**"]),
        feature("Off origin", "https://example.com", &["**"]),
    ]);
    assert_eq!(map.len(), 4, "unnamed and off-origin entries are skipped");
    let changed = paths(&["src/billing/Plan.tsx", "app/help/page.tsx", "README.md"]);
    assert_eq!(
        changed_pages(&map, &changed),
        ["/settings/billing", "/help"]
    );
    let labels = labels(&map, "/settings/billing");
    let names: Vec<&str> = labels.iter().map(|label| label.name.as_str()).collect();
    assert_eq!(names, ["Billing", "Invoices"]);
    assert!(changed_pages(&map, &[]).is_empty());
}

#[test]
fn drift_lists_missing_route_files_and_unmatched_globs_without_changing_the_map() {
    let map = vec![
        feature("Fine", "/", &["src/home/**"]),
        Feature {
            route_file: Some("app/old/page.tsx".into()),
            ..feature("Moved", "/old", &["src/home/**", "src/old/**"])
        },
        feature("No sources", "/about", &[]),
    ];
    let files = paths(&["src/home/Home.tsx", "package.json"]);
    let found = drift(&map, &files);
    assert_eq!(
        found,
        [Drift {
            index: 1,
            missing_route_file: Some("app/old/page.tsx".into()),
            unmatched_sources: vec!["src/old/**".into()],
        }]
    );
    assert_eq!(map.len(), 3);
}

#[test]
fn saved_maps_load_from_older_and_damaged_ledgers() {
    use crate::commands::project_registry::ProjectRecord;
    let old: ProjectRecord =
        serde_json::from_str(r#"{"id":"a","name":"A","path":"/a","reviewPages":["/"]}"#).unwrap();
    assert!(old.feature_map.is_empty());
    let mixed: ProjectRecord = serde_json::from_str(
        r#"{"id":"a","name":"A","path":"/a","featureMap":[
            {"name":"Search","page":"/search","working":"Results list","sources":["src/search/**"],"future":true},
            {"name":42},
            "not an entry"
        ]}"#,
    )
    .unwrap();
    assert_eq!(mixed.feature_map.len(), 1);
    assert_eq!(mixed.feature_map[0].working, "Results list");
    let odd: ProjectRecord =
        serde_json::from_str(r#"{"id":"a","name":"A","path":"/a","featureMap":{"x":1}}"#).unwrap();
    assert!(odd.feature_map.is_empty());
    let saved = serde_json::to_value(&old).unwrap();
    assert!(saved.get("featureMap").is_none());
}

fn reader<'a>(files: &'a HashMap<&'a str, &'a str>) -> impl Fn(&str) -> Option<String> + 'a {
    |path| files.get(path).map(|text| text.to_string())
}

#[test]
fn suggestions_read_file_routes_for_common_frameworks() {
    let contents = HashMap::from([
        ("web/package.json", r#"{"dependencies":{"next":"15"}}"#),
        ("docs/package.json", r#"{"devDependencies":{"astro":"5"}}"#),
        (
            "kit/package.json",
            r#"{"devDependencies":{"@sveltejs/kit":"2"}}"#,
        ),
        (
            "remix/package.json",
            r#"{"dependencies":{"@remix-run/react":"2"}}"#,
        ),
        ("package.json", r#"{"devDependencies":{"typescript":"5"}}"#),
    ]);
    let files = paths(&[
        "package.json",
        "web/package.json",
        "web/app/page.tsx",
        "web/app/(marketing)/pricing/page.tsx",
        "web/app/settings/billing/page.tsx",
        "web/app/settings/billing/Plan.tsx",
        "web/app/posts/[id]/page.tsx",
        "web/app/api/hello/route.ts",
        "web/pages/_app.tsx",
        "docs/package.json",
        "docs/src/pages/guides/index.mdx",
        "docs/src/pages/404.astro",
        "kit/package.json",
        "kit/src/routes/+page.svelte",
        "kit/src/routes/(app)/dashboard/+page.svelte",
        "kit/src/routes/blog/[slug]/+page.svelte",
        "remix/package.json",
        "remix/app/routes/_index.tsx",
        "remix/app/routes/account.settings.tsx",
        "remix/app/routes/_auth.login.tsx",
        "remix/app/routes/notes.$id.tsx",
        "remix/app/routes/reports/route.tsx",
        "src/pages/Unrouted.tsx",
    ]);
    let found = suggest(&files, reader(&contents));
    let pages: Vec<&str> = found.iter().map(|f| f.page.as_str()).collect();
    assert_eq!(
        pages,
        [
            "/",
            "/404",
            "/dashboard",
            "/guides",
            "/login",
            "/pricing",
            "/reports",
            "/account/settings",
            "/settings/billing"
        ]
    );
    let billing = found
        .iter()
        .find(|f| f.page == "/settings/billing")
        .unwrap();
    assert_eq!(billing.name, "Settings billing");
    assert_eq!(billing.sources, ["web/app/settings/billing/**"]);
    assert_eq!(
        billing.route_file.as_deref(),
        Some("web/app/settings/billing/page.tsx")
    );
    let home = &found[0];
    assert_eq!(home.name, "Home");
    assert_eq!(
        home.sources,
        ["web/app/page.tsx"],
        "a root page claims only its file"
    );
    assert!(home.working.is_empty() && home.steps.is_empty());
}

#[test]
fn suggestions_read_router_definitions_and_navigation() {
    let contents = HashMap::from([
        (
            "package.json",
            r#"{"dependencies":{"react-router-dom":"7","react":"19"}}"#,
        ),
        (
            "src/router.tsx",
            r#"createBrowserRouter([{ path: "/", element: <Home/> }, { path: '/projects', element: <List/> },
               { path: "/projects/:id" }, { path: "*" }, { mypath: "/nope" }])"#,
        ),
        (
            "src/components/Sidebar.tsx",
            r#"<NavLink to="/settings">Settings</NavLink><a href="https://example.com">x</a><Link to={"/help"} />"#,
        ),
        ("src/widgets/Card.tsx", r#"<Link to="/hidden" />"#),
    ]);
    let files = paths(&[
        "package.json",
        "src/router.tsx",
        "src/components/Sidebar.tsx",
        "src/widgets/Card.tsx",
    ]);
    let found = suggest(&files, reader(&contents));
    let pages: Vec<&str> = found.iter().map(|f| f.page.as_str()).collect();
    assert_eq!(pages, ["/", "/help", "/projects", "/settings"]);
    let projects = found.iter().find(|f| f.page == "/projects").unwrap();
    assert_eq!(projects.route_file.as_deref(), Some("src/router.tsx"));
    assert_eq!(projects.sources, ["src/router.tsx"]);
}

#[test]
fn projects_without_a_known_router_get_no_suggestions() {
    let contents = HashMap::from([("package.json", r#"{"dependencies":{"express":"5"}}"#)]);
    let files = paths(&["package.json", "src/routes.ts", "pages/index.tsx"]);
    assert!(suggest(&files, reader(&contents)).is_empty());
    assert!(suggest(&paths(&["main.rs"]), |_| None).is_empty());
    let broken = HashMap::from([("package.json", "{ not json")]);
    assert!(suggest(&paths(&["package.json", "app/page.tsx"]), reader(&broken)).is_empty());
}
