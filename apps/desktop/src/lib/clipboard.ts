/**
 * Copies text that may still be loading. When it is (`pending`), and the platform accepts
 * a clipboard item that resolves later, the write starts inside the click, so webviews
 * that require a user gesture still allow it; otherwise the text is written once ready.
 */
export async function copyText(text: () => Promise<string>, pending: boolean) {
  if (pending && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    const blob = text().then((value) => new Blob([value], { type: 'text/plain' }));
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
    return;
  }
  await navigator.clipboard.writeText(await text());
}
