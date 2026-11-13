import { invokeNative } from './native/transport.ts';

export type Editor = 'vscode' | 'cursor';

export const editorName = (editor: Editor) => (editor === 'vscode' ? 'VS Code' : 'Cursor');

/** Opens a saved project's folder in the editor; the native side looks the folder up by id. */
export function openProjectInEditor(projectId: string, editor: Editor): Promise<void> {
  return invokeNative<void>('project_open_editor', { projectId, editor });
}
