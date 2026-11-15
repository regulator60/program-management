import type { Dependency } from "./dependencies";
import { childMap, flattenTree, isLate } from "./hierarchy";
import { matchesFilter, type Filter, type Model } from "./model";
import type { IssueView } from "./store";
import type { ActionItem } from "./types";

export type Severity = "critical" | "serious" | "warning" | "info" | "good";

export const SEVERITY_ORDER: Severity[] = ["critical", "serious", "warning", "info", "good"];

export type Insight = {
  id: string;
  severity: Severity;
  category: "milestone" | "dependency" | "risk" | "decision" | "action" | "data";
  title: string;
  detail: string;
  href: string;
  /** The issue this is mainly about, for grouping/dedupe. */
  key?: string;
  /** The critical path milestone this ultimately puts at risk, if any. */
  threatens?: { key: string; summary: string };
  /** Sort hint within a severity: bigger = more urgent. */
  weight: number;
  /** A question to put to the team in a weekly (S0) call. */
  question?: string;
};

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const fmt = (iso: string | null) =>
  iso
    ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : "no date";
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Walk up the plan hierarchy to the critical path milestone (and outcome) above an issue. */
export function ancestry(m: Model) {
  const { children, byKey } = childMap(m.issues, m.links, m.cfg);
  const parentOf = new Map<string, string>();
  for (const [p, kids] of children) for (const k of kids) if (!parentOf.has(k)) parentOf.set(k, p);
  return (key: string) => {
    let cur = byKey.get(key);
    let cpm: IssueView | undefined;
    let outcome: IssueView | undefined;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.key)) {
      seen.add(cur.key);
      if (cur.level === "cpm" && !cpm) cpm = cur;
      if (cur.level === "outcome") outcome = cur;
      const p = parentOf.get(cur.key);
      cur = p ? byKey.get(p) : undefined;
    }
    return { cpm, outcome };
  };
}

/**
 * Turn the model into a ranked list of things a track lead or executive should
 * know, most urgent first. Every insight links to where to act on it.
 */
export function buildInsights(m: Model, f: Filter, actionItems: ActionItem[] = []): Insight[] {
  const out: Insight[] = [];
  const up = ancestry(m);
  const inView = (k: string) => matchesFilter(m, k, f);
  const today = m.today;

  // --- Milestones: late, and plans that don't fit
  const nodes = flattenTree(m.tree);
  for (const n of nodes) {
    const i = n.issue;
    if (!i.inScope || !["cpm", "ipm_intent", "ipm"].includes(i.level) || !inView(i.key)) continue;
    const isCpm = i.level === "cpm";
    if (isLate(i, today)) {
      const d = days(i.dueDate!, today);
      out.push({
        id: `late-${i.key}`,
        severity: isCpm ? "critical" : "serious",
        category: "milestone",
        title: `${isCpm ? "Critical path milestone" : "Milestone"} ${i.key} is ${plural(d, "day")} past due`,
        detail: `${i.summary}. Was due ${fmt(i.dueDate)}, still ${i.status}.`,
        href: `/items/${i.key}`,
        key: i.key,
        threatens: isCpm ? undefined : (() => { const c = up(i.key).cpm; return c ? { key: c.key, summary: c.summary } : undefined; })(),
        weight: d + (isCpm ? 1000 : 0),
        question: `What's the recovery date for ${i.key}, what's blocking it, and who owns the plan?`,
      });
    } else if (i.statusCategory !== "done" && n.rollup.latestChildDue && i.dueDate && n.rollup.latestChildDue > i.dueDate) {
      const d = days(i.dueDate, n.rollup.latestChildDue);
      out.push({
        id: `overrun-${i.key}`,
        severity: isCpm ? "critical" : "serious",
        category: "milestone",
        title: `Plan for ${i.key} finishes ${plural(d, "day")} after its due date`,
        detail: `${i.summary} is due ${fmt(i.dueDate)}, but work under it is scheduled to ${fmt(n.rollup.latestChildDue)}.`,
        href: `/hierarchy`,
        key: i.key,
        weight: d + (isCpm ? 500 : 0),
        question: `Do we re-plan the work under ${i.key}, add capacity, or move the milestone date?`,
      });
    }
  }

  // --- Dependencies: conflicts traced to the milestone they threaten
  const depInView = (d: Dependency) => inView(d.successor.key) || inView(d.predecessor.key);
  for (const d of m.deps) {
    if (!depInView(d)) continue;
    const mine = d.direction === "outgoing" ? d.predecessor : d.successor;
    const { cpm } = up(mine.key);
    const threatens = cpm ? { key: cpm.key, summary: cpm.summary } : undefined;
    const other = d.direction === "outgoing" ? d.successor : d.predecessor;
    if (d.health === "conflict") {
      out.push({
        id: `dep-${d.predecessor.key}-${d.successor.key}`,
        severity: d.direction === "outgoing" ? "serious" : threatens ? "critical" : "serious",
        category: "dependency",
        title:
          d.direction === "outgoing"
            ? `${other.key} needs ${mine.key} ${plural(d.slipDays ?? 0, "day")} sooner than it's planned`
            : `${d.predecessor.key} lands ${plural(d.slipDays ?? 0, "day")} after ${d.successor.key} needs it`,
        detail: `${d.predecessor.summary} → ${d.successor.summary}.${threatens ? ` Puts ${threatens.key} (${threatens.summary}) at risk.` : ""}`,
        href: `/dependencies?key=${mine.key}`,
        key: mine.key,
        threatens,
        weight: (d.slipDays ?? 0) + (threatens ? 200 : 0),
        question:
          d.direction === "outgoing"
            ? `Can we deliver ${mine.key} sooner, or agree a new need-by date with the ${other.key} team?`
            : `Can ${d.predecessor.key} pull in, or do we re-sequence ${d.successor.key}? Who escalates to the other track, and by when?`,
      });
    } else if (d.health === "overdue") {
      out.push({
        id: `depdue-${d.predecessor.key}-${d.successor.key}`,
        severity: "serious",
        category: "dependency",
        title: `${d.predecessor.key} is overdue and ${d.successor.key} is waiting on it`,
        detail: `${d.predecessor.summary} was due ${fmt(d.predecessor.dueDate)}.`,
        href: `/dependencies?key=${mine.key}`,
        key: mine.key,
        threatens,
        weight: days(d.predecessor.dueDate!, today),
        question: `What's the new ETA for ${d.predecessor.key}, and who is chasing it?`,
      });
    } else if (d.health === "unknown" && d.direction === "incoming") {
      out.push({
        id: `depnodate-${d.predecessor.key}-${d.successor.key}`,
        severity: "warning",
        category: "dependency",
        title: `${d.predecessor.key} has no committed date, and ${d.successor.key} depends on it`,
        detail: `${d.predecessor.summary}. Ask the owning team for a date.`,
        href: `/dependencies?key=${mine.key}`,
        key: mine.key,
        threatens,
        weight: 1,
        question: `Who will get a committed date for ${d.predecessor.key} from the owning team, and by when?`,
      });
    }
    // Other teams moving dates on us
    const slips = d.recentChanges.filter((c) => c.field === "dueDate" && c.oldValue && c.newValue && c.newValue > c.oldValue);
    if (d.direction === "incoming" && slips.length) {
      const c = slips[0];
      const by = days(c.oldValue!, c.newValue!);
      out.push({
        id: `slip-${c.id}`,
        severity: d.health === "conflict" ? "serious" : "warning",
        category: "dependency",
        title: `${c.key} moved its due date out ${plural(by, "day")}`,
        detail: `${fmt(c.oldValue)} → ${fmt(c.newValue)}. ${d.successor.key} (${d.successor.summary}) depends on it.`,
        href: `/dependencies?key=${mine.key}`,
        key: c.key,
        threatens,
        weight: by,
        question: `What does the ${c.key} slip mean for ${d.successor.key}? Do we need to re-plan or escalate?`,
      });
    }
  }

  // --- Risks & decisions
  for (const i of m.issues) {
    if (i.statusCategory === "done" || !inView(i.key)) continue;
    if (i.level === "risk" && (i.tier === 1 || i.tier === 2)) {
      const due = i.dueDate ? days(today, i.dueDate) : null;
      out.push({
        id: `risk-${i.key}`,
        severity: due !== null && due < 0 ? "serious" : "warning",
        category: "risk",
        title: `Tier ${i.tier} risk open: ${i.summary}`,
        detail: `${i.key} · owner ${i.assignee ?? "unassigned"} · ${due === null ? "no target date" : due < 0 ? `mitigation ${plural(-due, "day")} overdue` : `mitigation due ${fmt(i.dueDate)}`}.`,
        href: `/raid`,
        key: i.key,
        weight: (3 - (i.tier ?? 3)) * 10 + (due !== null && due < 0 ? -due : 0),
        question: "Is the mitigation on track? What help do we need, and from whom?",
      });
    }
    if (i.level === "decision" && i.dueDate) {
      const due = days(today, i.dueDate);
      if (due <= 7) {
        out.push({
          id: `dec-${i.key}`,
          severity: due < 0 ? "serious" : "warning",
          category: "decision",
          title: due < 0 ? `Decision ${i.key} is ${plural(-due, "day")} overdue` : `Decision ${i.key} needed by ${fmt(i.dueDate)}`,
          detail: `${i.summary}${i.tier ? ` (tier ${i.tier})` : ""} · owner ${i.assignee ?? "unassigned"}.`,
          href: `/raid`,
          key: i.key,
          weight: -due,
          question: "Who makes this decision and by when? What do they need from us?",
        });
      }
    }
  }

  // --- Action items
  const overdueLocal = actionItems.filter((a) => a.status === "open" && a.dueDate && a.dueDate < today);
  const overdueIntake = m.issues.filter((i) => i.isIntake && isLate(i, today));
  const overdue = overdueLocal.length + overdueIntake.length;
  if (overdue) {
    out.push({
      id: "actions-overdue",
      severity: "warning",
      category: "action",
      title: `${plural(overdue, "action item")} overdue`,
      detail: [...overdueIntake.map((i) => i.summary), ...overdueLocal.map((a) => a.text)].slice(0, 3).join(" · "),
      href: "/actions",
      weight: overdue,
      question: "Close out or re-date each overdue action.",
    });
  }

  // --- Data quality
  const undated = m.issues.filter(
    (i) => i.inScope && ["cpm", "ipm_intent", "ipm", "epic"].includes(i.level) && !i.dueDate && i.statusCategory !== "done" && inView(i.key),
  );
  if (undated.length) {
    out.push({
      id: "undated",
      severity: "info",
      category: "data",
      title: `${plural(undated.length, "milestone or epic")} without a due date`,
      detail: undated.slice(0, 5).map((i) => i.key).join(", "),
      href: "/hierarchy",
      weight: undated.length,
      question: "Who will add dates to these items before next week?",
    });
  }

  // --- Good news: milestones completed recently
  const since = new Date(Date.parse(today) - 14 * DAY).toISOString();
  for (const c of m.changes) {
    if (c.field !== "status" || c.detectedAt < since) continue;
    const i = m.byKey.get(c.key);
    if (!i || !i.inScope || i.statusCategory !== "done" || !["cpm", "ipm_intent", "ipm", "epic"].includes(i.level) || !inView(i.key)) continue;
    out.push({
      id: `done-${c.id}`,
      severity: "good",
      category: "milestone",
      title: `${i.key} completed`,
      detail: i.summary,
      href: `/items/${i.key}`,
      key: i.key,
      weight: 0,
    });
  }

  // De-duplicate by id, then sort.
  const unique = [...new Map(out.map((x) => [x.id, x])).values()];
  return unique.sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.weight - a.weight,
  );
}

/** One-paragraph executive summary built from the insights. */
export function headline(insights: Insight[], rag: "red" | "amber" | "green", trackName: string): string {
  const critical = insights.filter((i) => i.severity === "critical");
  const threatened = [...new Map(critical.filter((i) => i.threatens).map((i) => [i.threatens!.key, i.threatens!])).values()];
  const parts: string[] = [];
  if (rag === "green") parts.push(`${trackName} is on track.`);
  else if (rag === "amber") parts.push(`${trackName} is on track with items to watch.`);
  else parts.push(`${trackName} needs attention.`);
  if (threatened.length) {
    parts.push(
      `${plural(threatened.length, "critical path milestone")} at risk: ${threatened.map((t) => `${t.key} ${t.summary}`).join("; ")}.`,
    );
  }
  const deps = insights.filter((i) => i.category === "dependency" && (i.severity === "critical" || i.severity === "serious")).length;
  if (deps) parts.push(`${plural(deps, "dependency issue")} need cross-track follow-up.`);
  const risks = insights.filter((i) => i.category === "risk").length;
  if (risks) parts.push(`${plural(risks, "tier 1/2 risk")} open.`);
  if (!critical.length && !deps) parts.push("No critical issues.");
  return parts.join(" ");
}
