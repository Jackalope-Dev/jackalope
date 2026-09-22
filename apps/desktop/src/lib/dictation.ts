export function pcmWave(samples: Float32Array, sampleRate = 16000): Uint8Array {
  if (samples.length > sampleRate * 60) throw new Error('Record up to one minute at a time.');
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return bytes;
}

export async function recordingWave(blob: Blob): Promise<Uint8Array> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 61) throw new Error('Record up to one minute at a time.');
    const renderer = new OfflineAudioContext(
      1,
      Math.min(60 * 16000, Math.ceil(decoded.duration * 16000)),
      16000,
    );
    const source = renderer.createBufferSource();
    source.buffer = decoded;
    source.connect(renderer.destination);
    source.start();
    return pcmWave((await renderer.startRendering()).getChannelData(0));
  } finally {
    await context.close();
  }
}
