/** Link público de bot no x.ai: https://x.ai/bot/<id>. */
const RE_LINK = /https:\/\/x\.ai\/bot\/([A-Za-z0-9_-]+)/i;

export function acharLinkBotX(texto: string): string | null {
  const m = String(texto ?? "").match(RE_LINK);
  if (!m) return null;
  return `https://x.ai/bot/${m[1]}`;
}
