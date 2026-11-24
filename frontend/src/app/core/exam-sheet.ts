// Pure helpers for the exam answer sheet (kept apart from the component so they are easy to test).

/** Toggle one letter in an answer ("BD" + "A" -> "ABD"). */
export function toggleLetter(answer: string, letter: string): string {
  const set = new Set(answer.split(""));
  if (set.has(letter)) set.delete(letter);
  else set.add(letter);
  return [...set].sort().join("");
}

/** Time left in ms, never negative. */
export const timeLeft = (deadline: number, now = Date.now()) => Math.max(0, deadline - now);

export function clock(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
