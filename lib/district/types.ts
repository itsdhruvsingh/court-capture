/**
 * Court Cases — shared shapes.
 *
 * Three layers, kept apart on purpose (the same rule as Advanced Intelligence):
 * the raw HTML the court site sent is stored untouched in `court_case_raw`,
 * these parsed shapes are our reading of it, and AI order summaries are a
 * separate, later interpretation on the order row. A parser fix re-reads the
 * raw HTML; it never needs another captcha.
 */

// ── parsed from the court site ────────────────────────────────────────────

export type CaseTypeOption = { code: string; name: string };

/** One row of a "search by case type" result list. */
export type ListedCase = {
  cnr: string;
  estCode: string;
  establishment: string;
  serial: number | null;
  /** As printed: "CS DJ/4290/2024". */
  caseNumber: string;
  typeLabel: string;
  number: number | null;
  year: number | null;
  petitioner: string;
  respondent: string;
  masked: boolean;
  requestToken: string | null;
};

export type ResultBlock = {
  estCode: string;
  establishment: string;
  total: number | null;
  nextPage: number | null;
  rows: ListedCase[];
};

export type Party = {
  index: number;
  name: string;
  /** As printed, possibly several names. */
  advocate: string | null;
  advocates: string[];
  /** Every line of the entry as printed (name, advocate, address, notes). */
  lines?: string[];
};

export type Hearing = {
  seq: number;
  judge: string | null;
  businessDate: string | null;
  nextDate: string | null;
  purpose: string | null;
  /** The decoded `data-case` blob behind the "Business on date" link. */
  business: Record<string, unknown> | null;
};

export type ParsedOrder = {
  kind: "interim" | "final";
  orderNo: number;
  orderDate: string | null;
  label: string | null;
  sourceUrl: string | null;
};

export type GenericTable = {
  caption: string;
  headers: string[];
  rows: Record<string, string>[];
};

export type ParsedCase = {
  cnr: string;
  establishment: string | null;
  caseTypeFull: string | null;
  caseTypeLabel: string | null;
  filingNumber: string | null;
  filingDate: string | null;
  registrationNumber: string | null;
  registrationDate: string | null;
  caseNo: number | null;
  caseYear: number | null;
  firstHearingDate: string | null;
  nextHearingDate: string | null;
  decisionDate: string | null;
  status: "pending" | "disposed" | null;
  stage: string | null;
  natureOfDisposal: string | null;
  courtJudge: string | null;
  petitioners: Party[];
  respondents: Party[];
  acts: { act: string; sections: string }[];
  fir: Record<string, string> | null;
  hearings: Hearing[];
  orders: ParsedOrder[];
  /** Every other table (process details, transfers, IA status…) verbatim. */
  extra: GenericTable[];
  /** Every table on the page verbatim, including the ones parsed above. */
  tables: GenericTable[];
  /** The page's headings and captions, in order: which sections the court showed. */
  sections: string[];
  masked: boolean;
};

// ── what the dashboard reads ──────────────────────────────────────────────

export type RunStatus = "running" | "paused" | "done" | "cancelled" | "failed";
export type TaskStatus = "pending" | "active" | "done" | "exhausted" | "failed" | "skipped";

/** What the extension should do next on the court's page. */
export type CaptureAction =
  | {
      action: "search";
      runId: string;
      taskId: string;
      caseType: string;
      caseTypeName: string;
      year: number;
      status: "P" | "D";
      complexCode: string;
      context: string;
    }
  | {
      action: "details";
      runId: string;
      caseId: string;
      cnr: string;
      estCode: string;
      context: string;
    }
  | { action: "paused" | "done" | "cancelled" | "none" | "wait"; runId: string | null; message: string };

/** One person's extension: a stable id per browser, and who signed the token. */
export type Capturer = { id: string; name: string; staffId?: string };

/** What one person has done on a run. */
export type PersonStats = { captchas?: number; cases?: number; searches?: number };

/** How much a person had to type for one step, reported by the extension. */
export type CaptchaEffort = { prompts?: number; wrong?: number; solveMs?: number };

export type RunStats = {
  searches?: number;
  emptyYears?: number;
  details?: number;
  /** Case pages the court served without asking for a captcha. */
  detailsFree?: number;
  detailsFailed?: number;
  captchasSolved?: number;
  captchasWrong?: number;
  solveMsTotal?: number;
  /** Per person, keyed by short name. */
  people?: Record<string, PersonStats>;
};

export type RunSnapshot = {
  run: {
    id: string;
    status: RunStatus;
    caseStatus: "P" | "D";
    perType: number;
    maxYears: number;
    startYear: number;
    label: string | null;
    stats: RunStats;
    lastError: string | null;
    createdAt: string;
    finishedAt: string | null;
    createdByName: string | null;
  };
  /** Whether any extension is working on this run right now. */
  capturer: { active: boolean; lastSeen: string | null };
  /** Who is working right now, and on which case types. */
  capturers: { name: string; caseTypes: string[] }[];
  tasks: {
    id: string;
    code: string;
    name: string;
    status: TaskStatus;
    nextYear: number;
    yearsTried: number;
    wanted: number;
    found: number;
    fetched: number;
    note: string | null;
    /** The person holding this case type right now, if anyone. */
    claimedBy: string | null;
  }[];
  totals: { listed: number; fetched: number; failed: number; wanted: number };
  /** The last things the capture did, in words, newest first. */
  activity: string[];
};

export type OrderSummary = {
  headline: string;
  order_type: string;
  outcome: string;
  summary: string;
  present: string[];
  directions: string[];
  key_points: string[];
  next_date: string | null;
  next_purpose: string | null;
  judge: string | null;
};
