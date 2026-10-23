/**
 * High Court — dates for a judge's searches.
 *
 * A judge's first search covers the run's whole range (see the engine). These
 * random windows are the fallback: `days` days starting anywhere between
 * `earliest` and the day before today, avoiding windows already tried for the
 * same judge so another attempt looks somewhere new. Dates are plain
 * YYYY-MM-DD strings, computed in UTC so no timezone shifts a day.
 */

const DAY = 86_400_000;

const ms = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function daysBetween(a: string, b: string) {
  return Math.round((ms(b) - ms(a)) / DAY);
}

export function toDmy(isoDate: string) {
  return `${isoDate.slice(8, 10)}-${isoDate.slice(5, 7)}-${isoDate.slice(0, 4)}`;
}

/** The same day `years` years earlier; 29 February becomes the 28th. */
export function yearsBefore(isoDate: string, years: number) {
  const y = +isoDate.slice(0, 4) - years;
  const m = +isoDate.slice(5, 7);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(+isoDate.slice(8, 10), last)).padStart(2, "0")}`;
}

/** Today in India, YYYY-MM-DD. */
export function istToday() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function randomWindow(args: { earliest: string; days: number; today?: string; avoid: { from: string; to: string }[]; rand?: () => number }) {
  const rand = args.rand ?? Math.random;
  const today = args.today ?? istToday();
  const span = Math.max(1, args.days) - 1;
  const lo = ms(args.earliest);
  const hi = Math.max(lo, ms(today) - DAY - span * DAY); // the window ends yesterday at the latest
  const overlaps = (from: number) => {
    const to = from + span * DAY;
    return args.avoid.some((w) => from <= ms(w.to) && to >= ms(w.from));
  };
  const pick = () => lo + Math.floor(rand() * ((hi - lo) / DAY + 1)) * DAY;
  let start = pick();
  for (let i = 0; i < 20 && overlaps(start); i++) start = pick();
  if (overlaps(start)) {
    // Mostly covered already: choose among the start days that are still free.
    const free: number[] = [];
    for (let t = lo; t <= hi; t += DAY) if (!overlaps(t)) free.push(t);
    if (free.length) start = free[Math.floor(rand() * free.length)];
  }
  return { from: iso(start), to: iso(start + span * DAY) };
}
