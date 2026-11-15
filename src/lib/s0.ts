import type { Dependency } from "./dependencies";
import { isLate } from "./hierarchy";
import { buildInsights, type Insight, type Severity } from "./insights";
import { groupReport, matchesFilter, type Filter, type GroupReport, type Model } from "./model";
import { actionInScope, type ProgramAction } from "./programActions";
import type { IssueView } from "./store";
import type { ActionItem, IssueChange, ProgramAssignment, Scope } from "./types";

const DAY = 86_400_000;
const fmt = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export type AgendaItem = {
  id: string;
  section: "wins" | "discuss" | "asks" | "actions" | "changes";
  severity: Severity;
  title: string;
  question: string;
  href: string;
};

export type S0 = {
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
  data: { actions: ActionItem[]; programs: ProgramAction[] },
  opts: { lookaheadDays?: number } = {},
): S0 {
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

  // ---- agenda
  const agenda: AgendaItem[] = [];
  for (const w of wins) {
    agenda.push({ id: `win-${w.key}`, section: "wins", severity: "good", title: `${w.key} ${w.summary} completed`, question: "Anything to hand off or celebrate?", href: `/items/${w.key}` });
  }
  for (const i of insights.filter((x) => x.severity !== "good" && x.category !== "action").slice(0, 8)) {
    agenda.push({ id: i.id, section: "discuss", severity: i.severity, title: i.title, question: i.question ?? "What should we do?", href: i.href });
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

  return { scope, filter: f, report, insights, agenda, milestones, deps, risks: raid("risk"), decisions: raid("decision"), programAsks, teamActions, changes, wins };
}
