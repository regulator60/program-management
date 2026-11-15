import type { Dependency } from "./dependencies";
import { isLate } from "./hierarchy";
import { buildInsights, type Insight, type Severity } from "./insights";
import { groupReport, matchesFilter, type Filter, type GroupReport, type Model } from "./model";
import { actionInScope, type ProgramAction } from "./programActions";
import type { IssueView } from "./store";
import type { ActionItem, IssueChange, ItemUpdate, ProgramAssignment, Scope } from "./types";

const DAY = 86_400_000;
const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type AgendaItem = {
  id: string;
  section: "wins" | "discuss" | "review" | "asks" | "actions" | "changes";
  severity: Severity;
  title: string;
  question: string;
  href: string;
};

/** A risk or decision that should be talked about in this call, and why. */
export type ReviewTopic = {
  issue: IssueView;
  severity: Severity;
  reasons: string[];
  question: string;
  lastUpdate: ItemUpdate | null;
  /** Most recent of: our last update, Jira's last change. */
  lastActivity: string | null;
  daysSinceActivity: number | null;
  weight: number;
};

export type S0 = {
  /** Risks & decisions that need discussing (with reasons), most urgent first. */
  reviewTopics: ReviewTopic[];
  /** Open risks & decisions that look fine this week. */
  quietRaid: { issue: IssueView; lastUpdate: ItemUpdate | null }[];
  /** Latest update per Jira key. */
  latestUpdate: Map<string, ItemUpdate>;
  scope: Scope;
  filter: Filter;
  report: GroupReport;
  insights: Insight[];
  agenda: AgendaItem[];
  /** Open milestones due within the look-ahead window or already late, plus ones completed in the last 14 days. */
  milestones: IssueView[];
  deps: Dependency[];
  risks: IssueView[];
  decisions: IssueView[];
  programAsks: { action: ProgramAction; assignment: ProgramAssignment }[];
  teamActions: ActionItem[];
  /** Field changes in the last 7 days on this team's items or the items they depend on. */
  changes: (IssueChange & { issue: IssueView | undefined })[];
  /** Milestones completed in the last 14 days. */
  wins: IssueView[];
};

export function scopeFilter(s: Scope): Filter {
  return s.kind === "subtrack" ? { subTrack: s.name } : { platform: s.name };
}

/**
 * Everything one sub-track or platform needs for its weekly (S0) call, plus a
 * generated agenda: wins first, then the issues worth discussing (each with a
 * question to put to the team), program asks, overdue actions and changes.
 */
export function buildS0(
  m: Model,
  scope: Scope,
  data: { actions: ActionItem[]; programs: ProgramAction[]; updates?: ItemUpdate[] },
  opts: { lookaheadDays?: number } = {},
): S0 {
  const latestUpdate = new Map<string, ItemUpdate>();
  for (const u of data.updates ?? []) {
    const prev = latestUpdate.get(u.key);
    if (!prev || u.createdAt > prev.createdAt) latestUpdate.set(u.key, u);
  }
  const f = scopeFilter(scope);
  const inScope = (k: string) => matchesFilter(m, k, f);
  const today = m.today;
  const horizon = new Date(Date.parse(today) + (opts.lookaheadDays ?? 42) * DAY).toISOString().slice(0, 10);
  const weekAgo = new Date(Date.parse(today) - 7 * DAY).toISOString();
  const twoWeeksAgo = new Date(Date.parse(today) - 14 * DAY).toISOString();

  const teamActions = data.actions.filter((a) => a.kind === "team" && actionInScope(a, scope, m));
  const insights = buildInsights(m, f, teamActions);
  const report = groupReport(m, scope.name, f);

  const isMs = (i: IssueView) => i.inScope && ["cpm", "ipm_intent", "ipm"].includes(i.level) && inScope(i.key);
  const doneRecently = new Set(
    m.changes.filter((c) => c.field === "status" && c.detectedAt >= twoWeeksAgo).map((c) => c.key),
  );
  const wins = m.issues.filter((i) => isMs(i) && i.statusCategory === "done" && doneRecently.has(i.key));
  // Late or due within the look-ahead, topped up to at least the next 3 so there's always something to discuss.
  const open = m.issues
    .filter((i) => isMs(i) && i.statusCategory !== "done")
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const milestones = open.filter(
    (i, idx) => isLate(i, today) || (!!i.dueDate && i.dueDate <= horizon) || idx < 3,
  );

  const deps = m.deps.filter((d) => {
    const mine = d.direction === "outgoing" ? d.predecessor : d.successor;
    return inScope(mine.key) && d.health !== "done";
  });
  const raid = (level: "risk" | "decision") =>
    m.issues
      .filter((i) => i.level === level && i.statusCategory !== "done" && inScope(i.key))
      .sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));

  const programAsks = data.programs
    .filter((p) => !p.closed)
    .flatMap((p) =>
      p.assignments
        .filter((a) => a.scope.kind === scope.kind && a.scope.name === scope.name)
        .map((assignment) => ({ action: p, assignment })),
    )
    .sort((a, b) => Number(a.assignment.status === "done") - Number(b.assignment.status === "done"));

  const watched = new Set([
    ...m.issues.filter((i) => inScope(i.key)).map((i) => i.key),
    ...deps.flatMap((d) => [d.predecessor.key, d.successor.key]),
  ]);
  const changes = m.changes
    .filter((c) => c.detectedAt >= weekAgo && watched.has(c.key) && ["dueDate", "startDate", "status"].includes(c.field))
    .map((c) => ({ ...c, issue: m.byKey.get(c.key) }));

  // ---- risks & decisions to review
  const { topics: reviewTopics, quiet: quietRaid } = reviewRaid(
    m,
    [...raid("risk"), ...raid("decision")],
    latestUpdate,
    m.cfg.analysis.staleDays ?? 7,
  );

  // ---- agenda
  const agenda: AgendaItem[] = [];
  for (const w of wins) {
    agenda.push({ id: `win-${w.key}`, section: "wins", severity: "good", title: `${w.key} ${w.summary} completed`, question: "Anything to hand off or celebrate?", href: `/items/${w.key}` });
  }
  // Risks/decisions are covered by their own review section below.
  for (const i of insights
    .filter((x) => x.severity !== "good" && !["action", "risk", "decision"].includes(x.category))
    .slice(0, 8)) {
    agenda.push({ id: i.id, section: "discuss", severity: i.severity, title: i.title, question: i.question ?? "What should we do?", href: i.href });
  }
  for (const t of reviewTopics) {
    agenda.push({
      id: `review-${t.issue.key}`,
      section: "review",
      severity: t.severity,
      title: `${t.issue.level === "risk" ? "Risk" : "Decision"} ${t.issue.key}: ${t.issue.summary}`,
      question: `${t.reasons.join(" · ")}. ${t.question}`,
      href: `#raid-${t.issue.key}`,
    });
  }
  for (const { action: p, assignment: a } of programAsks.filter((x) => x.assignment.status !== "done")) {
    const due = a.dueDate ?? p.dueDate;
    const overdue = !!due && due < today;
    agenda.push({
      id: `ask-${a.id}`,
      section: "asks",
      severity: overdue ? "serious" : "warning",
      title: `Program ask: ${p.title}`,
      question: overdue
        ? `This was due ${fmt(due)}. What's left, and when will ${scope.name} finish its part?`
        : `Who owns ${scope.name}'s part, and will it be done by ${due ? fmt(due) : "the due date"}?`,
      href: `/actions?${scope.kind}=${encodeURIComponent(scope.name)}`,
    });
  }
  const overdueActions = teamActions.filter((a) => a.status === "open" && a.dueDate && a.dueDate < today);
  if (overdueActions.length) {
    agenda.push({
      id: "overdue-actions",
      section: "actions",
      severity: "warning",
      title: `${overdueActions.length} overdue action item${overdueActions.length === 1 ? "" : "s"}`,
      question: "Close out, re-date or re-assign each one.",
      href: `/actions`,
    });
  }
  const slips = changes.filter((c) => c.field === "dueDate" && c.oldValue && c.newValue && c.newValue > c.oldValue);
  if (slips.length) {
    agenda.push({
      id: "slips",
      section: "changes",
      severity: "info",
      title: `${slips.length} date${slips.length === 1 ? "" : "s"} moved out this week: ${[...new Set(slips.map((c) => c.key))].join(", ")}`,
      question: "Are the new dates realistic? Does anything downstream need to move?",
      href: `/dependencies`,
    });
  }

  return { reviewTopics, quietRaid, latestUpdate, scope, filter: f, report, insights, agenda, milestones, deps, risks: raid("risk"), decisions: raid("decision"), programAsks, teamActions, changes, wins };
}

/**
 * Decide which open risks/decisions need airtime this week. A topic is raised when:
 *  - nobody has updated it for `staleDays` (our updates or Jira's last change) → ask for an update
 *  - our last update said it's blocked or stalled → ask what would move it
 *  - its target date has passed, or lands within 14 days
 *  - it spans multiple tracks (tier 1–2) and has any of the above, or no owner
 */
export function reviewRaid(m: Model, items: IssueView[], latest: Map<string, ItemUpdate>, staleDays: number) {
  const today = m.today;
  const dayDiff = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
  const topics: ReviewTopic[] = [];
  const quiet: { issue: IssueView; lastUpdate: ItemUpdate | null }[] = [];
  for (const issue of items) {
    const lastUpdate = latest.get(issue.key) ?? null;
    if (lastUpdate?.progress === "resolved") {
      quiet.push({ issue, lastUpdate });
      continue;
    }
    const candidates = [lastUpdate?.createdAt, issue.updatedAt].filter((x): x is string => !!x).sort();
    const lastActivity = candidates.length ? candidates[candidates.length - 1] : null;
    const since = lastActivity ? dayDiff(lastActivity, today) : null;
    const owner = issue.assignee ?? "the owner";
    const isDecision = issue.level === "decision";
    const reasons: string[] = [];
    let question = "";
    let weight = 0;
    let severity: Severity = "info";
    const bump = (s: Severity) => {
      const order: Severity[] = ["critical", "serious", "warning", "info", "good"];
      if (order.indexOf(s) < order.indexOf(severity)) severity = s;
    };

    if (lastUpdate?.progress === "blocked") {
      reasons.push(`Blocked as of ${fmt(lastUpdate.createdAt.slice(0, 10))}`);
      question ||= "What's needed to unblock it, and from whom?";
      bump("serious");
      weight += 40;
    } else if (lastUpdate?.progress === "stalled") {
      reasons.push(`Stalled as of ${fmt(lastUpdate.createdAt.slice(0, 10))}`);
      question ||= "What would get this moving again? Does it need escalating?";
      bump("warning");
      weight += 25;
    }
    if (since === null || since >= staleDays) {
      reasons.push(since === null ? "No updates recorded" : `No update in ${since} days`);
      question ||= `${owner}: what's the latest? Is it moving?`;
      bump("warning");
      weight += 20 + Math.min(since ?? 30, 30);
    }
    if (issue.dueDate) {
      const due = dayDiff(today, issue.dueDate);
      if (due < 0) {
        reasons.push(`${isDecision ? "Decision" : "Mitigation"} ${-due} days overdue`);
        question ||= isDecision ? "Who is making this call, and what's the new date?" : "What's the new mitigation date? Do we escalate?";
        bump("serious");
        weight += 30 + Math.min(-due, 30);
      } else if (due <= 14) {
        reasons.push(`${isDecision ? "Needed" : "Due"} in ${due} day${due === 1 ? "" : "s"}`);
        question ||= isDecision ? "Do we have what we need to decide by then?" : `On track for ${fmt(issue.dueDate)}?`;
        bump("warning");
        weight += 15 - due / 2;
      }
    }
    if (!issue.assignee) {
      reasons.push("No owner");
      question ||= "Who owns this?";
      bump("warning");
      weight += 10;
    }
    if (reasons.length && (issue.tier === 1 || issue.tier === 2)) {
      reasons.push(`Tier ${issue.tier}, multi-track`);
      weight += issue.tier === 1 ? 20 : 10;
      if (issue.tier === 1) bump("serious");
    }

    if (!reasons.length) {
      quiet.push({ issue, lastUpdate });
      continue;
    }
    topics.push({
      issue,
      severity,
      reasons,
      question: question || "Any change?",
      lastUpdate,
      lastActivity,
      daysSinceActivity: since,
      weight,
    });
  }
  topics.sort((a, b) => b.weight - a.weight);
  return { topics, quiet };
}

