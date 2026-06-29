/**
 * Fisher–Yates shuffle. Returns a new array; the input is not mutated.
 *
 * Preferred over the common `.sort(() => Math.random() - 0.5)` idiom, which is
 * statistically biased — this drives benchmark read order, so even, uniform
 * coverage matters.
 */
export function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
