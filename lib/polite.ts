import { AppError } from "./errors";

/**
 * Talking to court websites, gently.
 *
 * Every download from one court host goes through a single queue in this
 * process, a few seconds apart, however many people are saving cases at once.
 * If a court answers with its security verification (its bot check), that host
 * is left alone for a while: we wait it out, we never retry into it.
 */

export class CourtChallenge extends AppError {
  constructor(message: string) {
    super(message, 503);
    this.name = "CourtChallenge";
  }
}

type Host = { queue: Promise<unknown>; last: number; quietUntil: number };
const hosts = new Map<string, Host>();

const GAP_MS = 4000;
const QUIET_MS = 30 * 60_000;

function host(name: string): Host {
  let h = hosts.get(name);
  if (!h) {
    h = { queue: Promise.resolve(), last: 0, quietUntil: 0 };
    hosts.set(name, h);
  }
  return h;
}

/** When downloads from this host resume, or null if they are not paused. */
export function pausedUntil(name: string): Date | null {
  const h = hosts.get(name);
  return h && Date.now() < h.quietUntil ? new Date(h.quietUntil) : null;
}

export function politely<T>(name: string, job: () => Promise<T>): Promise<T> {
  const h = host(name);
  const run = h.queue.then(async () => {
    if (Date.now() < h.quietUntil) {
      const at = new Date(h.quietUntil).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
      throw new CourtChallenge(`Downloads from ${name} are paused until ${at}: the court showed its security verification.`);
    }
    const wait = h.last + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await job();
    } catch (e) {
      if (e instanceof CourtChallenge) h.quietUntil = Date.now() + QUIET_MS;
      throw e;
    } finally {
      h.last = Date.now();
    }
  });
  h.queue = run.catch(() => undefined);
  return run;
}

/** A court's bot-check page, recognised by what it says. */
export function looksLikeChallenge(head: string) {
  return /security verification|verify you are human|are you a robot|challenge-platform|cf-chl/i.test(head);
}
