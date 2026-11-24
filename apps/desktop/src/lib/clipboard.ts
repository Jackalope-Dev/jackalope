/**
 * Copies text that may still be loading. When it is (`pending`), and the platform accepts
 * a clipboard item that resolves later, the write starts inside the click, so webviews
 * that require a user gesture still allow it. Otherwise, or when that write is refused,
 * the text is written once ready. A failure to produce the text is reported as itself.
 */
export async function copyText(text: () => Promise<string>, pending: boolean) {
  const value = text();
  const clipboard = navigator.clipboard;
  if (pending && typeof ClipboardItem !== 'undefined' && clipboard?.write) {
    try {
      const blob = value.then((result) => new Blob([result], { type: 'text/plain' }));
      // The write reports a loading failure itself; this keeps it from also being unhandled.
      blob.catch(() => {});
      await clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch {
      // Some webviews have ClipboardItem but refuse one whose data is still a promise.
    }
  }
  const result = await value;
  if (!clipboard?.writeText) throw new Error('Copying is not available here.');
  await clipboard.writeText(result);
}
