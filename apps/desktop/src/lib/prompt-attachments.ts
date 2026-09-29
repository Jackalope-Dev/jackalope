/** Window event asking the open new-work composer to add attachment lines (detail: string[]). */
export const ATTACH_TO_COMPOSER = 'jackalope:attach-to-composer';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const SEPARATORS = /[\\/]+/g;

function normalize(path: string) {
  return path.replace(SEPARATORS, '/').replace(/\/$/, '');
}

export function isImagePath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

/**
 * The line added to a prompt for an attached file. Project files are written
 * relative to the project so isolated worktrees resolve their own copy; files
 * outside the project, and pasted images kept under the ignored `.jackalope`
 * folder, keep their absolute path because a worktree does not contain them.
 */
export function attachmentReference(path: string, projectPath?: string) {
  const file = normalize(path);
  const root = projectPath ? normalize(projectPath) : '';
  const inside =
    root && file.toLowerCase().startsWith(`${root.toLowerCase()}/`)
      ? file.slice(root.length + 1)
      : '';
  // Windows paths can arrive with mixed separators; show one consistent style.
  const absolute = path.includes('\\') ? path.replace(/\//g, '\\') : path;
  const shown = inside && !inside.startsWith('.jackalope/') ? inside : absolute;
  return `${isImagePath(path) ? 'Attached image' : 'Attached file'}: ${shown}`;
}

/** Adds attachment lines at the end of the draft, one per line, skipping duplicates. */
export function appendAttachments(text: string, references: string[]) {
  const existing = new Set(text.split(/\r?\n/).map((line) => line.trim()));
  const added = references.filter((line) => !existing.has(line));
  if (!added.length) return text;
  const trimmed = text.replace(/\s+$/, '');
  const lastLine = trimmed.split(/\r?\n/).pop() ?? '';
  const separator = !trimmed ? '' : draftAttachments(lastLine).length ? '\n' : '\n\n';
  return `${trimmed}${separator}${added.join('\n')}`;
}

/** Attachment lines currently in a draft, for listing and removal. */
export function draftAttachments(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^Attached (image|file): \S/.test(line));
}

export function removeAttachment(text: string, reference: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== reference)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}
