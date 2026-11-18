import type { DatabaseSync } from "node:sqlite";

/**
 * Everything that differs between Jira instances lives here, so the app can be
 * pointed at a real Jira Server without code changes. Edited on /settings and
 * stored in the `settings` table as JSON.
 *
 * Secrets (Jira / Confluence personal access tokens) are NOT stored here: they
 * come from environment variables (JIRA_PAT, CONFLUENCE_PAT).
 */
export type AppConfig = {
  trackName: string;
  jira: {
    baseUrl: string; // e.g. https://jira.example.com
    /** JQL returning everything in *your* track. */
    scopeJql: string;
    /** JQL for program action items on the intake board. */
    intakeJql: string;
    /** Max results per page when searching. */
    pageSize: number;
    /** Delay between write calls when pushing via REST (ms) — Jira Server is touchy. */
    writeDelayMs: number;
    /** Status to move a program action item to when every assigned team is done. */
    doneStatus: string;
  };
  confluence: {
    baseUrl: string;
  };
  issueTypes: {
    outcome: string[];
    cpm: string[];
    ipm: string[];
    epic: string[];
    risk: string[];
    decision: string[];
    action: string[];
  };
  fields: {
    /** Custom field id for start date, e.g. customfield_12345. */
    startDate: string;
    /** Field for target / due date. "duedate" or a customfield id. */
    dueDate: string;
    /** Epic Link custom field id (Jira Server), e.g. customfield_10008. */
    epicLink: string;
    /** Optional custom field holding risk/decision tier. Blank = derive from labels. */
    tier: string;
    /** Optional custom field holding sub-track. Blank = use subTrackLabelPrefix / components. */
    subTrack: string;
  };
  /** Column headers to use when generating a CSV for Jira's importer. */
  csvColumns: {
    startDate: string;
    dueDate: string;
  };
  labels: {
    intent: string; // label marking "Intent" interim milestones
    intake: string; // label marking program action items
    platformPrefix: string; // "Domain:" → platform name follows
    subTrackPrefix: string; // e.g. "SubTrack:" (used if fields.subTrack blank)
    tierPattern: string; // regex with one capture group for tier number
  };
  links: {
    /** Outward verb of the hierarchy link (e.g. "contains"). Case-insensitive. */
    containsOutward: string;
  };
  analysis: {
    /** Dependencies finishing within this many days of when you need them are flagged as "tight". */
    bufferDays: number;
    /** Dates changed within this many days are shown as "recently updated". */
    recentChangeDays: number;
    /** Risks/decisions with no update for this many days are flagged for an update in S0. */
    staleDays: number;
  };
  /**
   * The in-app assistant (Settings → Assistant). Empty values fall back to the
   * environment variables (ASSISTANT_ENABLED, ANTHROPIC_BASE_URL, ASSISTANT_MODEL,
   * ASSISTANT_EFFORT). The API key always stays in the environment.
   */
  assistant: {
    /** "" = follow ASSISTANT_ENABLED; otherwise off | demo | on. */
    mode: "" | "off" | "demo" | "on";
    /** Confirmed on the Settings page that the endpoint is approved for real program data (required for "on"). */
    approvedForRealData: boolean;
    baseUrl: string;
    model: string;
    effort: "" | "low" | "medium" | "high";
    /** auto = on for Anthropic's API, off for a custom endpoint. */
    refusalFallback: "auto" | "on" | "off";
  };
};

export const DEFAULT_CONFIG: AppConfig = {
  trackName: "Digital",
  jira: {
    baseUrl: "",
    scopeJql: 'project = BIGP AND labels = "Track:Digital"',
    intakeJql: "project = BIGP AND labels = intake",
    pageSize: 100,
    writeDelayMs: 750,
    doneStatus: "Done",
  },
  confluence: { baseUrl: "" },
  issueTypes: {
    outcome: ["Outcome"],
    cpm: ["Critical Path Milestone", "CP Milestone"],
    ipm: ["Interim Path Milestone", "Interim Milestone", "Milestone"],
    epic: ["Epic"],
    risk: ["Risk"],
    decision: ["Decision"],
    action: ["Action Item"],
  },
  fields: {
    startDate: "customfield_10015",
    dueDate: "duedate",
    epicLink: "customfield_10014",
    tier: "",
    subTrack: "",
  },
  csvColumns: {
    startDate: "Start Date",
    dueDate: "Due Date",
  },
  labels: {
    intent: "Intent",
    intake: "intake",
    platformPrefix: "Domain:",
    subTrackPrefix: "SubTrack:",
    tierPattern: "^tier[\\s:_-]*([123])$",
  },
  links: { containsOutward: "contains" },
  analysis: { bufferDays: 5, recentChangeDays: 14, staleDays: 7 },
  assistant: { mode: "", approvedForRealData: false, baseUrl: "", model: "", effort: "", refusalFallback: "auto" },
};

function deepMerge<T>(base: T, override: unknown): T {
  if (
    typeof base !== "object" ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== "object" ||
    override === null
  ) {
    return (override ?? base) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(override as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

export function getConfig(db: DatabaseSync): AppConfig {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'config'")
    .get() as { value: string } | undefined;
  if (!row) return DEFAULT_CONFIG;
  try {
    return deepMerge(DEFAULT_CONFIG, JSON.parse(row.value));
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(db: DatabaseSync, config: AppConfig) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES ('config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(JSON.stringify(config));
}
