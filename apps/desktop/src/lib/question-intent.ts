const ASKING =
  /^(how|what|why|where|when|which|who|whose|does|do|did|is|are|was|were|can|could|should|would|will|explain|describe|summarize|summarise|tell me|show me|walk me through|list)\b/i;
const CHANGING =
  /\b(fix|add|implement|change|update|refactor|remove|delete|create|build|write|make|rename|migrate|bump|upgrade|install|replace|move|convert|generate|commit|merge|deploy|edit|modify|rewrite|set up|setup)\b/i;

/** Short enough to judge from its words; longer requests are usually detailed code work. */
const brief = (value: string) => value.length <= 400 && value.split('\n').length <= 4;

/**
 * A short request that only asks for information. Such requests skip workspace
 * preparation; automatic checks already skip attempts that change nothing. Anything
 * ambiguous counts as work, so a mistake costs speed, never a missing setup step.
 */
export function isQuestionOnly(text: string): boolean {
  const value = text.trim();
  if (!value || !brief(value)) return false;
  if (CHANGING.test(value)) return false;
  return value.endsWith('?') || ASKING.test(value);
}

/** Words and names that tie a request to a codebase: its files, history, tooling or checks. */
const CODE =
  /\b(code|codebase|repo|repository|commit|branch|merge|rebase|pull request|PR|diff|patch|refactor|implement|fix|bug|debug|compile|build|lint|typecheck|type check|tests|unit tests?|test suite|failing test|function|method|component|module|endpoint|schema|migration|dependency|dependencies|npm|pnpm|yarn|cargo|pip|stack trace|deploy|release|CI|pipeline|script|config)\b|\b(src|lib|apps|packages)\/|\w\.(tsx?|jsx?|mjs|cjs|rs|py|go|rb|java|kt|swift|cpp|cs|php|css|scss|html|vue|svelte|json|ya?ml|toml|md|sql|sh|lock)\b/i;
/** Things outside the repository an agent reaches with its browser, desktop or connections. */
const OUTSIDE =
  /\b(web ?page|website|web site|site|browser|tab|url|link|mcp|connector|connection|integration|e-?mail|inbox|gmail|mail|calendar|slack|discord|notion|linear|jira|figma|google (docs?|sheets?|drive)|spreadsheet|window|screen|desktop|form|account|dashboard|status page)\b|https?:\/\/|\bwww\.|\b[\w-]+\.(com|org|net|io|dev|app|ai|co|so)\b/i;
/** Reading or operating something rather than producing files. */
const OPERATING =
  /\b(browse|check|look|open|visit|go to|navigate|read|search|find|summari[sz]e|monitor|watch|log ?in|sign ?in|fill|click|scroll|see|ping|verify|confirm|try|research|explore|compare|review|download|reply|respond|book|order|tell me|show me)\b/i;

/**
 * A short request that is clearly not code work: it reads or operates something outside
 * the repository (a web page, an MCP connection, email) and never mentions code, files or
 * changing anything. All three must hold, so anything ambiguous stays code work and a
 * mistake costs setup time, never a missing worktree for work that edits files.
 */
export function isNonCodeRequest(text: string): boolean {
  const value = text.trim();
  if (!value || !brief(value) || CHANGING.test(value) || CODE.test(value)) return false;
  return OUTSIDE.test(value) && (OPERATING.test(value) || isQuestionOnly(value));
}

/**
 * Why new work skips code setup (worktree, preparation, automatic checks and the
 * planning assessment), or undefined for code work:
 * - `general`: the project-less General folder, which has no code;
 * - `window`: an attached window, unless the request names code;
 * - `request`: the request itself is clearly non-code (see `isNonCodeRequest`).
 * `treatAsCode` is the person's override for the last two, which are inferred.
 */
export type NonCodeReason = 'general' | 'window' | 'request';

export function nonCodeReason(
  text: string,
  {
    general = false,
    window = false,
    treatAsCode = false,
  }: { general?: boolean; window?: boolean; treatAsCode?: boolean },
): NonCodeReason | undefined {
  if (general) return 'general';
  if (treatAsCode) return undefined;
  if (window && !CODE.test(text)) return 'window';
  return isNonCodeRequest(text) ? 'request' : undefined;
}
