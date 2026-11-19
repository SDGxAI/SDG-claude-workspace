/** Feste, freundliche Farbverläufe je Marke (für Kacheln und Kennzeichen). */
const GRADIENTS = [
  "from-rose-200 via-orange-100 to-amber-100",
  "from-sky-200 via-cyan-100 to-emerald-100",
  "from-violet-200 via-fuchsia-100 to-rose-100",
  "from-amber-200 via-yellow-100 to-lime-100",
  "from-emerald-200 via-teal-100 to-sky-100",
  "from-orange-200 via-rose-100 to-pink-100",
  "from-indigo-200 via-sky-100 to-cyan-100",
];

export function brandGradient(brand: string): string {
  let h = 0;
  for (const ch of brand) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}
