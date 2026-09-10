import { parsePatchFiles } from '@pierre/diffs';

self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({
      files: parsePatchFiles(event.data, undefined, true).flatMap((entry) => entry.files),
    });
  } catch {
    self.postMessage({ files: null });
  }
};
