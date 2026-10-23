/**
 * District court — where we read from.
 *
 * One court for now: the South Delhi district site, Saket Court Complex. The
 * site is the S3WaaS "ecourt" WordPress plugin that every district court in
 * India runs, so another district is a different `base` and `complexCode`.
 *
 * The court refuses direct API calls ("Direct API calls are forbidden"), so
 * cases are read by the Court Capture extension (extension/) driving the
 * court's own page in a person's browser, with that person typing each
 * captcha. The server never searches the court itself.
 */

export const COURT = {
  key: "southdelhi",
  base: "https://southdelhi.dcourts.gov.in",
  searchPage: "/case-status-search-by-case-type/",
  ajax: "/wp-admin/admin-ajax.php",
  /** The complex option's value on the form: all four establishments at once. */
  complexCode: "DLST01,DLST02,DLST03,DLST04",
  complexName: "Saket Court Complex",
} as const;

export const ESTABLISHMENTS: Record<string, string> = {
  DLST01: "District and Sessions Judge, South, Saket",
  DLST02: "Chief Metropolitan Magistrate, South, Saket",
  DLST03: "Senior Civil Judge cum RC, South, Saket",
  DLST04: "Principal Judge Family Court, South, Saket",
};

/**
 * The case types the court lists for the Saket complex, as of 2026-10-19.
 * A run is planned from this list; if the court drops a type, the extension
 * finds no such option on the form and the type is marked skipped.
 */
export const CASE_TYPES: { code: string; name: string }[] = [
  { code: "76", name: "ARB. A.(COMM.)" }, { code: "61", name: "ARBTN" }, { code: "69", name: "Bail Matters" },
  { code: "20", name: "CA" }, { code: "26", name: "CBI" }, { code: "79", name: "CMA" },
  { code: "82", name: "Contempt Petition" }, { code: "29", name: "CORRUPTION CASES" }, { code: "86", name: "Counter Claim" },
  { code: "41", name: "CourtComplaint" }, { code: "5", name: "CR" }, { code: "21", name: "Cr. Cases" },
  { code: "22", name: "Cr Rev" }, { code: "77", name: "CS (COMM)" }, { code: "17", name: "CS DJ" },
  { code: "16", name: "CS SCJ" }, { code: "24", name: "CT Cases" }, { code: "70", name: "DD" },
  { code: "30", name: "DPT EQ" }, { code: "31", name: "DPT EQ CR" }, { code: "68", name: "DR" },
  { code: "67", name: "E.P." }, { code: "42", name: "ESIC" }, { code: "38", name: "EX" },
  { code: "83", name: "Ex. - Award by Arb." }, { code: "84", name: "Ex.COMM - Award by Arb. Comm." }, { code: "39", name: "EX Crl" },
  { code: "80", name: "Execution (Comm.)" }, { code: "45", name: "GP" }, { code: "15", name: "Hindu Adp." },
  { code: "1", name: "HMA" }, { code: "4", name: "HTA" }, { code: "59", name: "IDA" },
  { code: "40", name: "Insolvency" }, { code: "2", name: "LAC" }, { code: "10", name: "LC" },
  { code: "52", name: "LCA" }, { code: "19", name: "LIR" }, { code: "12", name: "MACT" },
  { code: "25", name: "MC" }, { code: "32", name: "MCA DJ" }, { code: "34", name: "MCA SCJ" },
  { code: "64", name: "MCD APPL" }, { code: "71", name: "MCD CHL" }, { code: "54", name: "M-Ex" },
  { code: "47", name: "MGP" }, { code: "46", name: "MHA" }, { code: "85", name: "MIDAP" },
  { code: "36", name: "Misc Crl" }, { code: "33", name: "Misc DJ" }, { code: "81", name: "Misc. DR" },
  { code: "66", name: "Misc RC ARC" }, { code: "35", name: "Misc SCJ" }, { code: "48", name: "MPC" },
  { code: "14", name: "Muslim Law" }, { code: "75", name: "OMP (COMM.)" }, { code: "78", name: "OMP (E) (COMM.)" },
  { code: "72", name: "OMP (I) (COMM.)" }, { code: "74", name: "OMP MISC. (COMM.)" }, { code: "73", name: "OMP (T) (COMM.)" },
  { code: "53", name: "OP" }, { code: "7", name: "PC" }, { code: "3", name: "PPA" },
  { code: "27", name: "RCA DJ" }, { code: "8", name: "RC ARC" }, { code: "28", name: "RCA SCJ" },
  { code: "9", name: "RCT ARCT" }, { code: "51", name: "REC.CASES" }, { code: "55", name: "REVOCATION" },
  { code: "65", name: "RP" }, { code: "43", name: "RTI appeal" }, { code: "23", name: "SC" },
  { code: "18", name: "S C Court" }, { code: "60", name: "SMA" }, { code: "13", name: "Succ. Court" },
  { code: "44", name: "TC" }, { code: "6", name: "TM" }, { code: "57", name: "T.P. C" },
  { code: "58", name: "T.P. CRL" },
];

/** Used only for fetching order PDFs, which are plain document links. */
export const USER_AGENT = "Mozilla/5.0 (compatible; CourtCapture/1.0; +https://shadowcreativelabs.com)";

/** The desk shows "capturing now" while the extension checked in this recently. */
export const CAPTURE_SEEN_SECONDS = 90;

/** Defaults the user asked for: 10 newest cases per type, up to 10 years back. */
export const DEFAULT_PER_TYPE = 10;
export const DEFAULT_MAX_YEARS = 10;
