/**
 * High Court — shared shapes.
 */

import type { CaptchaEffort, Capturer, PersonStats } from "@/lib/district/types";

export type { CaptchaEffort, Capturer, PersonStats };

/** One row of the "Sitting Judges wise" results table, as we read it. */
export type HcRow = {
  serial: number | null;
  /** As printed: "W.P.(C)-8028/2025". */
  caseNo: string;
  /** The court's internal code from the row's comment, e.g. "CW". */
  caseTypeCode: string | null;
  /** The printed type, e.g. "W.P.(C)". */
  caseTypeLabel: string | null;
  caseNumber: number | null;
  caseYear: number | null;
  neutralCitation: string | null;
  orderDate: string | null;
  pdfUrl: string | null;
  txtUrl: string | null;
  petitioner: string | null;
  respondent: string | null;
  corrigendum: string | null;
  uploadedOn: string | null;
  remark: string | null;
  html: string;
};

export type HcResults = { rows: HcRow[]; total: number | null };

export type HcRunStatus = "running" | "paused" | "done" | "cancelled";
export type HcTaskStatus = "pending" | "done" | "exhausted" | "skipped";

export type HcRunStats = {
  searches?: number;
  emptyWindows?: number;
  judgments?: number;
  captchasSolved?: number;
  captchasWrong?: number;
  solveMsTotal?: number;
  people?: Record<string, PersonStats>;
};

/** What the extension should do next on the High Court's page. */
export type HcAction =
  | {
      action: "search";
      court: "highcourt";
      runId: string;
      taskId: string;
      judgeCode: string;
      judgeName: string;
      /** The window, ISO and as the court's form wants it (dd-mm-yyyy). */
      from: string;
      to: string;
      fromDmy: string;
      toDmy: string;
      context: string;
    }
  | { action: "paused" | "done" | "cancelled" | "none" | "wait"; court: "highcourt"; runId: string | null; message: string };

export type HcRunSnapshot = {
  run: {
    id: string;
    status: HcRunStatus;
    perJudge: number;
    maxTries: number;
    windowDays: number;
    earliest: string;
    label: string | null;
    stats: HcRunStats;
    lastError: string | null;
    createdAt: string;
    finishedAt: string | null;
    createdByName: string | null;
  };
  capturers: { name: string; judges: string[] }[];
  tasks: {
    id: string;
    judgeCode: string;
    judgeName: string;
    status: HcTaskStatus;
    wanted: number;
    found: number;
    tries: number;
    note: string | null;
    claimedBy: string | null;
  }[];
  totals: { found: number; wanted: number; judgesDone: number; judges: number };
  activity: string[];
};
