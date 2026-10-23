/**
 * Text helpers shared by both courts' parsers.
 */

export function clean(s: string | null | undefined): string {
  return String(s ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * "24-12-2024", "24-December-2024", "24th December 2024", "2024-12-24" →
 * "2024-12-24". Built from the parts, never through Date, so IST's +5:30 can
 * never move a hearing to the previous day.
 */
export function parseDate(input: string | null | undefined): string | null {
  const s = clean(input).toLowerCase();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const ok = (y: number, m: number, d: number) =>
    y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return ok(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]+([a-z]+)[\s\-/.,]+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 4)] !== undefined) return ok(+m[3], MONTHS[m[2].slice(0, 4)], +m[1]);
  if (m && MONTHS[m[2].slice(0, 3)] !== undefined) return ok(+m[3], MONTHS[m[2].slice(0, 3)], +m[1]);
  return null;
}
