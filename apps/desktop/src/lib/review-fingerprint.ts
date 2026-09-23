export function reviewFingerprint(value: string) {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return `${value.length}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}
