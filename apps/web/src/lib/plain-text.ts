export function isPlainText(value: string): boolean {
  if (value.includes('<') || value.includes('>')) return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
