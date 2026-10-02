const ASKING =
  /^(how|what|why|where|when|which|who|whose|does|do|did|is|are|was|were|can|could|should|would|will|explain|describe|summarize|summarise|tell me|show me|walk me through|list)\b/i;
const CHANGING =
  /\b(fix|add|implement|change|update|refactor|remove|delete|create|build|write|make|rename|migrate|bump|upgrade|install|replace|move|convert|generate|commit|merge|deploy|edit|modify|rewrite|set up|setup)\b/i;

/**
 * A short request that only asks for information. Such requests skip workspace
 * preparation; automatic checks already skip attempts that change nothing. Anything
 * ambiguous counts as work, so a mistake costs speed, never a missing setup step.
 */
export function isQuestionOnly(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 400 || value.split('\n').length > 4) return false;
  if (CHANGING.test(value)) return false;
  return value.endsWith('?') || ASKING.test(value);
}
