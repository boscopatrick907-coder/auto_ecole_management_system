/** Accepts "6 99 12 34 56", "699123456", "00237…" or "+237…" and returns +237XXXXXXXXX. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/[^0-9+]/g, "").replace(/^00/, "+");
  if (/^[26][0-9]{8}$/.test(digits)) return "+237" + digits;
  if (/^237[26][0-9]{8}$/.test(digits)) return "+" + digits;
  return digits;
}

/** Desk codes: 6 digits shown as "482 913" (older 8-character codes as XXXX-XXXX). */
export function formatCode(code: string): string {
  const c = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^[0-9]{6}$/.test(c)) return `${c.slice(0, 3)} ${c.slice(3)}`;
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Link that opens "J'ai un code" with the code and phone already filled in. */
export function activationLink(origin: string, slug: string, code: string, phone: string): string {
  const tel = phone.replace(/^\+237/, "");
  const raw = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `${origin}/s/${encodeURIComponent(slug)}/activation?code=${encodeURIComponent(raw)}&tel=${encodeURIComponent(tel)}`;
}

export function activationMessage(
  school: string,
  code: string,
  phone: string,
  link: string,
  reset = false,
): string {
  const intro = reset
    ? `${school} — votre code pour choisir un nouveau mot de passe : ${formatCode(code)} (valable 2 jours).`
    : `${school} — bienvenue ! Votre code d’activation : ${formatCode(code)} (valable 7 jours).`;
  return `${intro}\nOuvrez ce lien, puis choisissez votre mot de passe :\n${link}\nVotre identifiant est votre numéro : ${phone}`;
}
