//! Which agent questions are routine enough for another agent to answer.
//!
//! Deterministic local rules, like the tool permission tiers in
//! `permission_risk.rs`: a question is `Routine` only when nothing in its text,
//! options or declared category touches something only the person can decide.
//! Secrets, payment, sign-ins, accounts, publishing, protected paths, changes of
//! direction and destructive actions always go to the person, and so does any
//! question too short or too long to judge. The rules are deliberately broad:
//! a false escalation costs the person one answer, a false `Routine` could
//! spend money or leak a credential.

use super::previews::features::glob_matches;
use rmcp::schemars;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum QuestionCategory {
    Routine,
    Secret,
    Payment,
    SignIn,
    Account,
    Publish,
    ProtectedPath,
    Direction,
    Destructive,
}

/// Categories that always reach the person, whatever a policy says.
pub const ALWAYS_ESCALATED: &[QuestionCategory] = &[
    QuestionCategory::Secret,
    QuestionCategory::Payment,
    QuestionCategory::SignIn,
    QuestionCategory::Account,
    QuestionCategory::Publish,
    QuestionCategory::ProtectedPath,
    QuestionCategory::Direction,
    QuestionCategory::Destructive,
];

impl QuestionCategory {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Routine => "routine",
            Self::Secret => "secret",
            Self::Payment => "payment",
            Self::SignIn => "sign_in",
            Self::Account => "account",
            Self::Publish => "publish",
            Self::ProtectedPath => "protected_path",
            Self::Direction => "direction",
            Self::Destructive => "destructive",
        }
    }

    fn noun(self) -> &'static str {
        match self {
            Self::Routine => "a routine choice",
            Self::Secret => "a secret or credential",
            Self::Payment => "payment or billing",
            Self::SignIn => "signing in",
            Self::Account => "creating an account",
            Self::Publish => "publishing or deploying",
            Self::ProtectedPath => "a protected path",
            Self::Direction => "the plan's direction or scope",
            Self::Destructive => "deleting or rewriting something",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Risk {
    Routine,
    /// `category` is a [`QuestionCategory`] name, or `unclear`.
    Escalate {
        category: String,
        reason: String,
    },
}

/// Phrases matched at a word start. A trailing `$` also requires a word end,
/// for short words that begin longer, unrelated ones ("prod" in "product").
const RULES: &[(QuestionCategory, &[&str])] = &[
    (
        QuestionCategory::Secret,
        &[
            "api key",
            "apikey",
            "api_key",
            "secret",
            "token",
            "password",
            "passphrase",
            "passwd",
            "credential",
            "private key",
            "ssh key",
            "access key",
            "signing key",
            "client id",
            "certificate",
            ".env",
            "env var",
            "environment variable",
            "keychain",
            "vault",
        ],
    ),
    (
        QuestionCategory::Payment,
        &[
            "payment",
            "pay$",
            "paid",
            "billing",
            "bill$",
            "invoice",
            "credit card",
            "card number",
            "pricing",
            "price",
            "subscription",
            "subscribe",
            "upgrade plan",
            "upgrade the plan",
            "upgrade your plan",
            "paid plan",
            "purchase",
            "buy$",
            "checkout",
            "charge",
            "refund",
            "quota increase",
            "cost$",
            "costs$",
            "spend",
        ],
    ),
    (
        QuestionCategory::SignIn,
        &[
            "sign in",
            "sign-in",
            "signin",
            "log in",
            "log-in",
            "login",
            "logged in",
            "oauth",
            "2fa",
            "two-factor",
            "two factor",
            "mfa$",
            "authenticat",
            "verification code",
            "one-time code",
            "otp$",
            "captcha",
            "sso$",
        ],
    ),
    (
        QuestionCategory::Account,
        &[
            "create an account",
            "create account",
            "create a new account",
            "new account",
            "sign up",
            "sign-up",
            "signup",
            "register an account",
            "register for",
            "account creation",
            "open an account",
        ],
    ),
    (
        QuestionCategory::Publish,
        &[
            "publish",
            "release$",
            "releases$",
            "deploy",
            "production",
            "prod$",
            "go live",
            "go-live",
            "launch",
            "dns$",
            "domain name",
            "custom domain",
            "app store",
            "play store",
            "push to main",
            "push to master",
            "merge to main",
            "merge into main",
            "merge to master",
            "tag a",
            "announce",
            "send email",
            "send an email",
            "email users",
            "notify users",
        ],
    ),
    (
        QuestionCategory::Destructive,
        &[
            "delet",
            "drop table",
            "drop the",
            "drop database",
            "drop column",
            "truncate",
            "force-push",
            "force push",
            "push --force",
            "push -f",
            "rewrite history",
            "rewrite the history",
            "rewrite git history",
            "reset --hard",
            "rm -rf",
            "wipe",
            "purge",
            "destroy",
            "erase",
            "irreversibl",
            "permanently",
            "overwrite",
            "discard",
        ],
    ),
    (
        QuestionCategory::Direction,
        &[
            "architect",
            "approved plan",
            "the plan$",
            "plan says",
            "deviat",
            "out of scope",
            "in scope",
            "scope change",
            "change the scope",
            "expand the scope",
            "reduce the scope",
            "the scope$",
            "scope of",
            "pivot",
            "rewrite",
            "re-write",
            "migrate to",
            "migration to",
            "tech stack",
            "framework",
            "new dependency",
            "add a dependency",
            "another dependency",
            "product direction",
            "direction$",
            "requirement",
            "acceptance criteri",
            "roadmap",
            "priorit",
            "should we build",
            "should we support",
            "drop the feature",
            "cut the feature",
            "remove the feature",
            "skip the feature",
            "change the goal",
            "different goal",
            "instead of the plan",
            "license",
            "legal",
            "privacy",
            "compliance",
        ],
    ),
];

const MIN_LENGTH: usize = 8;
const MAX_LENGTH: usize = 4000;

fn normalized(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

fn word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Whether `phrase` occurs at a word start in `text`; a trailing `$` also
/// needs a word end.
fn has(text: &str, phrase: &str) -> bool {
    let (phrase, whole) = match phrase.strip_suffix('$') {
        Some(stem) => (stem, true),
        None => (phrase, false),
    };
    let mut from = 0;
    while let Some(found) = text[from..].find(phrase) {
        let start = from + found;
        let end = start + phrase.len();
        let before = text[..start].chars().next_back();
        let after = text[end..].chars().next();
        let starts =
            before.is_none_or(|c| !word_char(c)) || !phrase.chars().next().is_some_and(word_char);
        let ends = !whole || after.is_none_or(|c| !word_char(c));
        if starts && ends {
            return true;
        }
        from = start + phrase.chars().next().map_or(1, char::len_utf8);
    }
    false
}

/// The literal part of a glob before its first wildcard, for spotting a
/// protected path named in prose ("migrations/" for `migrations/**`).
fn literal_prefix(glob: &str) -> String {
    glob.split(['*', '?', '['])
        .next()
        .unwrap_or_default()
        .trim_start_matches("./")
        .trim_end_matches('/')
        .to_lowercase()
}

/// Words in the text that look like repository paths.
fn path_words(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| c.is_whitespace() || "`'\"(),;:<>".contains(c))
        .map(|word| word.trim_end_matches(['.', '?', '!']))
        .filter(|word| word.contains('/') || (word.contains('.') && !word.starts_with('.')))
}

fn touches_protected(text: &str, protected: &[String]) -> Option<String> {
    for glob in protected {
        let prefix = literal_prefix(glob);
        if prefix.len() >= 3 && has(text, &prefix) {
            return Some(glob.clone());
        }
        if path_words(text).any(|word| glob_matches(glob, word.trim_start_matches("./"))) {
            return Some(glob.clone());
        }
    }
    None
}

/// Classifies one question. `declared` is the category the asking agent gave;
/// `protected` holds the path globs only the person may approve changes to.
/// Every text field the person would read is checked, so a sensitive choice
/// hidden in an option still escalates.
pub fn classify(
    question: &str,
    options: &[String],
    context: &[&str],
    declared: Option<QuestionCategory>,
    protected: &[String],
) -> Risk {
    if let Some(category) = declared.filter(|category| *category != QuestionCategory::Routine) {
        return Risk::Escalate {
            category: category.as_str().into(),
            reason: format!("The agent marked this as {}.", category.noun()),
        };
    }
    let length = question.trim().chars().count();
    if !(MIN_LENGTH..=MAX_LENGTH).contains(&length) || !question.chars().any(char::is_alphabetic) {
        return Risk::Escalate {
            category: "unclear".into(),
            reason: "The question is too short or too long to judge safely.".into(),
        };
    }
    let mut text = normalized(question);
    for extra in options
        .iter()
        .map(String::as_str)
        .chain(context.iter().copied())
    {
        text.push('\n');
        text.push_str(&normalized(extra));
    }
    if let Some(glob) = touches_protected(&text, protected) {
        return Risk::Escalate {
            category: QuestionCategory::ProtectedPath.as_str().into(),
            reason: format!("It touches {glob}, which only you may approve."),
        };
    }
    for (category, phrases) in RULES {
        if let Some(phrase) = phrases.iter().find(|phrase| has(&text, phrase)) {
            return Risk::Escalate {
                category: category.as_str().into(),
                reason: format!(
                    "It is about {} (\u{201c}{}\u{201d}).",
                    category.noun(),
                    phrase.trim_end_matches('$')
                ),
            };
        }
    }
    Risk::Routine
}

#[cfg(test)]
mod tests {
    use super::*;

    fn risk(question: &str) -> Risk {
        classify(question, &[], &[], None, &[])
    }

    fn category(question: &str) -> String {
        match risk(question) {
            Risk::Escalate { category, .. } => category,
            Risk::Routine => "routine".into(),
        }
    }

    #[test]
    fn routine_implementation_choices_stay_routine() {
        for question in [
            "Should the empty state use the muted or the accent illustration?",
            "Sort the task list by name or by last update?",
            "Name the helper parseCsv or readCsv?",
            "Use a table or a card grid for the results view?",
            "Should the toast close after 4 or 6 seconds?",
            "Put the shared date helper in src/lib/dates.ts or src/utils/dates.ts?",
            "Which icon fits the export button better: download or share?",
            "Is it fine to keep both unit tests in one file?",
            "Should the CSV include a header row?",
            "Do you want camelCase or snake_case keys in the JSON output?",
        ] {
            assert_eq!(risk(question), Risk::Routine, "{question}");
        }
    }

    #[test]
    fn each_sensitive_category_escalates() {
        let cases = [
            ("What is the Stripe API key I should use?", "secret"),
            ("Can you give me the database password?", "secret"),
            ("Which access token should the webhook use?", "secret"),
            ("Should I add OPENAI values to .env?", "secret"),
            ("Upgrade the plan to get more build minutes?", "payment"),
            ("Is it ok to purchase the premium icon pack?", "payment"),
            (
                "Which pricing tier should the landing page show?",
                "payment",
            ),
            ("Enter your credit card for the trial?", "payment"),
            ("Please sign in to Vercel so I can continue.", "sign_in"),
            (
                "Log in to the dashboard and approve the OAuth app?",
                "sign_in",
            ),
            ("What is the 2FA code you received?", "sign_in"),
            (
                "Should I create an account on Supabase for this?",
                "account",
            ),
            ("Can you sign up for a Resend workspace?", "account"),
            ("Ready to publish the package to npm?", "publish"),
            ("Deploy this to production now?", "publish"),
            ("Point the DNS record at the new host?", "publish"),
            ("Push to main once the checks pass?", "publish"),
            ("Can I delete the old migrations folder?", "destructive"),
            ("Should I force-push the rebased branch?", "destructive"),
            ("Drop the users table and recreate it?", "destructive"),
            ("Run rm -rf on the build cache?", "destructive"),
            (
                "Should we change the architecture to microservices?",
                "direction",
            ),
            (
                "This is out of scope for the approved plan; continue anyway?",
                "direction",
            ),
            ("Switch the framework from Express to Hono?", "direction"),
            (
                "Which requirement matters more if we cannot meet both?",
                "direction",
            ),
        ];
        for (question, expected) in cases {
            assert_eq!(category(question), expected, "{question}");
        }
    }

    #[test]
    fn short_words_only_match_whole_words() {
        assert_eq!(
            risk("Name the product card component ProductTile?"),
            Risk::Routine
        );
        assert_eq!(category("Ship it to prod today?"), "publish");
        assert_eq!(
            risk("Should the payload include the display name?"),
            Risk::Routine
        );
        assert_eq!(category("Should I pay for the larger runner?"), "payment");
        assert_eq!(
            risk("Use the costume icon or the mask icon?"),
            Risk::Routine
        );
    }

    #[test]
    fn sensitive_options_and_context_escalate_too() {
        let options = vec!["Keep the file".to_string(), "Delete the file".to_string()];
        assert_eq!(
            classify("Which way should I go here?", &options, &[], None, &[]),
            Risk::Escalate {
                category: "destructive".into(),
                reason: "It is about deleting or rewriting something (\u{201c}delet\u{201d})."
                    .into()
            }
        );
        assert!(matches!(
            classify(
                "Which option do you prefer?",
                &[],
                &["The deploy target is unclear."],
                None,
                &[]
            ),
            Risk::Escalate { category, .. } if category == "publish"
        ));
    }

    #[test]
    fn a_declared_category_wins_and_routine_is_still_checked() {
        assert!(matches!(
            classify("Which shade of blue?", &[], &[], Some(QuestionCategory::Payment), &[]),
            Risk::Escalate { category, .. } if category == "payment"
        ));
        assert!(matches!(
            classify(
                "Which API key goes in the config?",
                &[],
                &[],
                Some(QuestionCategory::Routine),
                &[]
            ),
            Risk::Escalate { category, .. } if category == "secret"
        ));
    }

    #[test]
    fn protected_paths_escalate_by_glob_or_named_folder() {
        let protected = vec![
            "migrations/**".to_string(),
            "package.json".to_string(),
            ".github/workflows/**".to_string(),
        ];
        for question in [
            "Should the new column go into migrations/0004_add_tags.sql?",
            "Add the lint script to package.json?",
            "Edit .github/workflows/ci.yml to cache pnpm?",
            "Is the migrations folder the right place for the seed data?",
        ] {
            assert!(
                matches!(
                    classify(question, &[], &[], None, &protected),
                    Risk::Escalate { category, .. } if category == "protected_path"
                ),
                "{question}"
            );
        }
        assert_eq!(
            classify(
                "Put the helper in src/lib/tags.ts?",
                &[],
                &[],
                None,
                &protected
            ),
            Risk::Routine
        );
    }

    #[test]
    fn unclear_questions_fail_closed() {
        for question in [
            "",
            "   ",
            "Ok?",
            "?????????????",
            &"a".repeat(MAX_LENGTH + 1),
        ] {
            assert_eq!(category(question), "unclear", "{question:?}");
        }
    }

    #[test]
    fn categories_serialize_as_snake_case_names() {
        for category in ALWAYS_ESCALATED {
            assert_eq!(
                serde_json::to_value(category).unwrap(),
                serde_json::json!(category.as_str())
            );
        }
        let parsed: QuestionCategory = serde_json::from_str("\"sign_in\"").unwrap();
        assert_eq!(parsed, QuestionCategory::SignIn);
        assert!(serde_json::from_str::<QuestionCategory>("\"whatever\"").is_err());
    }
}
