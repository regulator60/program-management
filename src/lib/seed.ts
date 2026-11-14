import type { DatabaseSync } from "node:sqlite";
import { getConfig } from "./config";
import { nowIso } from "./db";
import { normalizeIssue, type RawIssueLink, type RawJiraIssue } from "./jira/normalize";
import { importNoteText } from "./connectors";
import { clearAllData, upsertIssues } from "./store";

/**
 * Fictional demo data shaped like a real Jira Server pull, so every screen has
 * something to show before Jira is connected. Dates are relative to today.
 */
export function seedDemo(db: DatabaseSync) {
  const cfg = getConfig(db);
  clearAllData(db);
  const d = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  type Spec = {
    key: string;
    type: string;
    summary: string;
    status?: string;
    cat?: "new" | "indeterminate" | "done";
    start?: number;
    due?: number;
    labels?: string[];
    assignee?: string;
    epic?: string;
    contains?: string[];
    blocks?: string[];
    relates?: string[];
    scope?: boolean;
  };

  const ST = {
    auth: "SubTrack:Login_&_Auth",
    dash: "SubTrack:Dashboard",
    pay: "SubTrack:Payments",
  };

  const specs: Spec[] = [
    // Outcomes
    { key: "BIGP-1", type: "Outcome", summary: "Customers sign in once and see all their accounts", status: "In Progress", cat: "indeterminate", due: 150, contains: ["BIGP-10", "BIGP-11"] },
    { key: "BIGP-2", type: "Outcome", summary: "Customers pay and manage bills digitally", status: "In Progress", cat: "indeterminate", due: 140, contains: ["BIGP-12"] },
    // Critical path milestones
    { key: "BIGP-10", type: "Critical Path Milestone", summary: "Unified login live for pilot", status: "In Progress", cat: "indeterminate", start: -30, due: 60, contains: ["BIGP-20"], labels: [ST.auth] },
    { key: "BIGP-11", type: "Critical Path Milestone", summary: "Account dashboard GA", status: "To Do", cat: "new", start: 10, due: 120, contains: ["BIGP-21"], labels: [ST.dash] },
    { key: "BIGP-12", type: "Critical Path Milestone", summary: "Bill pay v2 launch", status: "In Progress", cat: "indeterminate", start: -10, due: 95, contains: ["BIGP-22"], labels: [ST.pay] },
    // Interim milestones with Intent label
    { key: "BIGP-20", type: "Interim Path Milestone", summary: "Auth flows build complete", status: "In Progress", cat: "indeterminate", start: -25, due: 25, labels: ["Intent", ST.auth], contains: ["BIGP-30", "BIGP-31"] },
    { key: "BIGP-21", type: "Interim Path Milestone", summary: "Dashboard MVP code complete", status: "To Do", cat: "new", start: 15, due: 80, labels: ["Intent", ST.dash], contains: ["BIGP-32"] },
    { key: "BIGP-22", type: "Interim Path Milestone", summary: "Payments integration ready", status: "In Progress", cat: "indeterminate", start: -5, due: 70, labels: ["Intent", ST.pay], contains: ["BIGP-33"] },
    // Interim milestones (no Intent)
    { key: "BIGP-30", type: "Interim Path Milestone", summary: "SSO token service ready", status: "In Progress", cat: "indeterminate", start: -25, due: 20, labels: [ST.auth], contains: ["BIGP-100"], blocks: ["BIGP-31"] },
    { key: "BIGP-31", type: "Interim Path Milestone", summary: "MFA UI complete on mobile", status: "In Progress", cat: "indeterminate", start: -10, due: 28, labels: [ST.auth], contains: ["BIGP-101", "BIGP-102"] },
    { key: "BIGP-32", type: "Interim Path Milestone", summary: "Accounts API integrated in dashboard", status: "To Do", cat: "new", start: 20, due: 65, labels: [ST.dash], contains: ["BIGP-103", "BIGP-104"] },
    { key: "BIGP-33", type: "Interim Path Milestone", summary: "Payee management complete", status: "In Progress", cat: "indeterminate", start: -5, due: 55, labels: [ST.pay], contains: ["BIGP-105"] },
    // Epics
    { key: "BIGP-100", type: "Epic", summary: "Token service", status: "In Progress", cat: "indeterminate", start: -25, due: 18, labels: ["Domain:API"], assignee: "Priya Shah", blocks: ["VIEW-60"] },
    { key: "BIGP-101", type: "Epic", summary: "MFA screens – iOS", status: "In Progress", cat: "indeterminate", start: -10, due: 30, labels: ["Domain:iOS"], assignee: "Marcus Lee" },
    { key: "BIGP-102", type: "Epic", summary: "MFA screens – Android", status: "In Progress", cat: "indeterminate", start: -10, due: 26, labels: ["Domain:Android"], assignee: "Ana Gomez" },
    { key: "BIGP-103", type: "Epic", summary: "Accounts aggregation API", status: "To Do", cat: "new", start: 40, due: 60, labels: ["Domain:API"], assignee: "Priya Shah" },
    { key: "BIGP-104", type: "Epic", summary: "Dashboard web experience", status: "To Do", cat: "new", start: 38, due: 64, labels: ["Domain:Web"], assignee: "Jordan Kim" },
    { key: "BIGP-105", type: "Epic", summary: "Payee add/edit/delete", status: "In Progress", cat: "indeterminate", start: -5, due: 50, labels: ["Domain:API", "Domain:Web"], assignee: "Sam Patel" },
    // Stories
    { key: "BIGP-110", type: "Story", summary: "Issue short-lived tokens", status: "Done", cat: "done", start: -25, due: -10, epic: "BIGP-100", labels: ["Domain:API"], assignee: "Priya Shah" },
    { key: "BIGP-111", type: "Story", summary: "Token refresh + revocation", status: "In Progress", cat: "indeterminate", start: -10, due: -2, epic: "BIGP-100", labels: ["Domain:API"], assignee: "Dev Rao" },
    { key: "BIGP-112", type: "Story", summary: "Load test token service", status: "To Do", cat: "new", start: 5, due: 16, epic: "BIGP-100", labels: ["Domain:API"] },
    { key: "BIGP-120", type: "Story", summary: "iOS OTP entry screen", status: "Done", cat: "done", start: -10, due: -3, epic: "BIGP-101", labels: ["Domain:iOS"], assignee: "Marcus Lee" },
    { key: "BIGP-121", type: "Story", summary: "iOS passkey enrollment", status: "In Progress", cat: "indeterminate", start: -2, due: 30, epic: "BIGP-101", labels: ["Domain:iOS"], assignee: "Marcus Lee" },
    { key: "BIGP-130", type: "Story", summary: "Android OTP entry screen", status: "In Progress", cat: "indeterminate", start: -10, due: 5, epic: "BIGP-102", labels: ["Domain:Android"], assignee: "Ana Gomez" },
    { key: "BIGP-131", type: "Story", summary: "Android passkey enrollment", status: "To Do", cat: "new", start: 6, due: 26, epic: "BIGP-102", labels: ["Domain:Android"] },
    { key: "BIGP-140", type: "Story", summary: "Aggregate balances endpoint", status: "To Do", cat: "new", start: 40, due: 52, epic: "BIGP-103", labels: ["Domain:API"] },
    { key: "BIGP-141", type: "Story", summary: "Account list endpoint pagination", status: "To Do", cat: "new", start: 45, due: 60, epic: "BIGP-103", labels: ["Domain:API"] },
    { key: "BIGP-150", type: "Story", summary: "Dashboard account tiles", status: "To Do", cat: "new", start: 38, due: 55, epic: "BIGP-104", labels: ["Domain:Web"] },
    { key: "BIGP-151", type: "Story", summary: "Dashboard empty + error states", status: "To Do", cat: "new", start: 50, due: 64, epic: "BIGP-104", labels: ["Domain:Web"] },
    { key: "BIGP-160", type: "Story", summary: "Payee API CRUD", status: "In Progress", cat: "indeterminate", start: -5, due: 20, epic: "BIGP-105", labels: ["Domain:API"], assignee: "Sam Patel" },
    { key: "BIGP-161", type: "Story", summary: "Payee web forms", status: "To Do", cat: "new", start: 15, due: 50, epic: "BIGP-105", labels: ["Domain:Web"], assignee: "Jordan Kim" },
    // Other tracks (dependencies) — out of scope
    { key: "VIEW-50", type: "Epic", summary: "[View Account] Balances API v3", status: "In Progress", cat: "indeterminate", start: -20, due: 70, scope: false, assignee: "View Account team", blocks: ["BIGP-103"] },
    { key: "VIEW-51", type: "Epic", summary: "[View Account] Account nickname service", status: "In Progress", cat: "indeterminate", start: -5, due: 35, scope: false, blocks: ["BIGP-104"] },
    { key: "VIEW-60", type: "Epic", summary: "[View Account] Login handoff to account view", status: "To Do", cat: "new", start: 22, due: 50, scope: false },
    { key: "NDIG-12", type: "Epic", summary: "[Non-Digital] Branch staff auth device rollout", status: "In Progress", cat: "indeterminate", start: -40, due: 15, scope: false, blocks: ["BIGP-10"] },
    { key: "PLAT-7", type: "Epic", summary: "[Platform] Fraud scoring API for payees", status: "To Do", cat: "new", scope: false, blocks: ["BIGP-105"] },
    { key: "NDIG-20", type: "Epic", summary: "[Non-Digital] Call center scripts for MFA", status: "Done", cat: "done", start: -60, due: -5, scope: false, blocks: ["BIGP-31"] },
    // Risks (tier 3 = my track; 1–2 = multi-track)
    { key: "BIGP-200", type: "Risk", summary: "MFA vendor SDK release may slip past MFA UI milestone", status: "Open", cat: "new", due: 14, labels: ["Tier-3", ST.auth, "Domain:iOS", "Domain:Android"], assignee: "Marcus Lee", relates: ["BIGP-31"] },
    { key: "BIGP-201", type: "Risk", summary: "Not enough Android test devices for passkey QA", status: "Mitigating", cat: "indeterminate", due: 20, labels: ["Tier-3", ST.auth, "Domain:Android"], assignee: "Ana Gomez" },
    { key: "BIGP-202", type: "Risk", summary: "View Account Balances API v3 timeline threatens Dashboard GA", status: "Open", cat: "new", due: 30, labels: ["Tier-2", ST.dash], assignee: "Track Lead", relates: ["VIEW-50", "BIGP-11"] },
    { key: "BIGP-203", type: "Risk", summary: "Regulatory review of new login flow not yet scheduled", status: "Open", cat: "new", due: 21, labels: ["Tier-1"], assignee: "Program Office" },
    { key: "BIGP-204", type: "Risk", summary: "Payee data migration volume", status: "Closed", cat: "done", due: -15, labels: ["Tier-3", ST.pay] },
    // Decisions
    { key: "BIGP-210", type: "Decision", summary: "Use passkeys as primary factor for pilot", status: "Decided", cat: "done", due: -20, labels: ["Tier-3", ST.auth] },
    { key: "BIGP-211", type: "Decision", summary: "Shared token format with View Account", status: "Open", cat: "new", due: 10, labels: ["Tier-2", ST.auth], assignee: "Priya Shah", relates: ["VIEW-60"] },
    { key: "BIGP-212", type: "Decision", summary: "Cross-track launch sequencing (Digital vs Non-Digital)", status: "Open", cat: "new", due: 18, labels: ["Tier-1"], assignee: "Program Office" },
    // Program action items from intake board
    { key: "BIGP-300", type: "Task", summary: "Send updated pilot timeline to program office", status: "To Do", cat: "new", due: 3, labels: ["intake"], assignee: "Track Lead" },
    { key: "BIGP-301", type: "Task", summary: "Confirm Android device budget with finance", status: "In Progress", cat: "indeterminate", due: -1, labels: ["intake", ST.auth], assignee: "Ana Gomez" },
    { key: "BIGP-302", type: "Task", summary: "Book regulatory pre-read for login flow", status: "Done", cat: "done", due: -4, labels: ["intake"], assignee: "Program Office" },
  ];

  const LINK = {
    contains: { name: "Milestone", outward: "contains", inward: "is contained by" },
    blocks: { name: "Blocks", outward: "blocks", inward: "is blocked by" },
    relates: { name: "Relates", outward: "relates to", inward: "relates to" },
  };

  // Build issuelinks on both ends, the way Jira returns them.
  const linksByKey = new Map<string, RawIssueLink[]>();
  const push = (k: string, l: RawIssueLink) => linksByKey.set(k, [...(linksByKey.get(k) ?? []), l]);
  for (const s of specs) {
    for (const [kind, targets] of [
      ["contains", s.contains],
      ["blocks", s.blocks],
      ["relates", s.relates],
    ] as const) {
      for (const t of targets ?? []) {
        push(s.key, { type: LINK[kind], outwardIssue: { key: t } });
        push(t, { type: LINK[kind], inwardIssue: { key: s.key } });
      }
    }
  }

  const syncedAt = nowIso();
  const items = specs.map((s) => {
    const raw: RawJiraIssue = {
      key: s.key,
      fields: {
        issuetype: { name: s.type },
        summary: s.summary,
        status: { name: s.status ?? "To Do", statusCategory: { key: s.cat ?? "new" } },
        assignee: s.assignee ? { displayName: s.assignee } : null,
        labels: s.labels ?? [],
        components: [],
        issuelinks: linksByKey.get(s.key) ?? [],
        updated: syncedAt,
        description: null,
      },
    };
    raw.fields[cfg.fields.dueDate || "duedate"] = s.due === undefined ? null : d(s.due);
    raw.fields[cfg.fields.startDate] = s.start === undefined ? null : d(s.start);
    if (s.epic) raw.fields[cfg.fields.epicLink] = s.epic;
    const n = normalizeIssue(raw, cfg, { inScope: s.scope !== false, source: "demo", syncedAt });
    return n;
  });
  upsertIssues(db, items);

  // Simulated history: other tracks moved dates since the last sync.
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
  const ins = db.prepare(
    "INSERT INTO issue_changes (key, field, old_value, new_value, detected_at) VALUES (?, ?, ?, ?, ?)",
  );
  ins.run("VIEW-50", "dueDate", d(45), d(70), ago(2));
  ins.run("VIEW-51", "dueDate", d(28), d(35), ago(5));
  ins.run("NDIG-12", "status", "To Do", "In Progress", ago(9));
  ins.run("BIGP-111", "dueDate", d(-8), d(-2), ago(3));
  ins.run("BIGP-31", "dueDate", d(24), d(28), ago(6));

  importNoteText(db, {
    title: "Digital track weekly sync",
    meetingDate: d(-2),
    body: [
      "Attendees: Track lead, Priya, Marcus, Ana, Jordan, Sam",
      "",
      "Login & Auth",
      "- Token refresh slipped ~1 week; Dev picking up revocation edge cases",
      "- AI: Priya to confirm shared token format with View Account by " + d(7),
      "- [ ] @marcus share MFA vendor SDK release notes due " + d(4),
      "",
      "Dashboard",
      "- View Account Balances API v3 moved out again (now " + d(70) + ")",
      "- Action: Jordan to draft mitigation options for Dashboard GA (owner: Jordan Kim) by " + d(10),
      "",
      "Payments",
      "- Fraud scoring API still has no date from Platform",
      "- TODO: escalate PLAT-7 date at program sync",
      "- [x] Payee migration volume risk closed",
    ].join("\n"),
  });
}
