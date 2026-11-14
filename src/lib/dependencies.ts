import type { AppConfig } from "./config";
import { isContainsLink } from "./hierarchy";
import type { IssueView } from "./store";
import type { IssueChange, Link } from "./types";

export type DepHealth = "conflict" | "overdue" | "tight" | "unknown" | "ok" | "done";

export const HEALTH_ORDER: DepHealth[] = ["conflict", "overdue", "tight", "unknown", "ok", "done"];

export type Dependency = {
  predecessor: IssueView;
  successor: IssueView;
  link: Link;
  /** incoming: I depend on someone. outgoing: someone depends on me. internal: both mine. */
  direction: "incoming" | "outgoing" | "internal";
  health: DepHealth;
  reason: string;
  /** Days predecessor finishes after the successor needs it (positive = late). */
  slipDays: number | null;
  /** Recent date/status changes on the *other* side of the dependency. */
  recentChanges: IssueChange[];
};

/**
 * Decide which end of a link is the predecessor.
 * "A blocks B" / "A precedes B" / "A is required by B" → A first.
 * "A depends on B" / "A is blocked by B" / "A requires B" → B first.
 * Anything else (relates to, clones, duplicates) isn't a dependency.
 */
export function linkDirection(l: Link): "from-first" | "to-first" | null {
  const v = l.outward.toLowerCase();
  if (/is blocked by|depends on|requires|follows|is dependent on|waits on|needs/.test(v)) return "to-first";
  if (/blocks|precedes|is required by|is needed by|enables|is a dependency (of|for)|must finish before/.test(v))
    return "from-first";
  const t = l.typeName.toLowerCase();
  if (/block|depend/.test(t)) return "from-first"; // Jira default "Blocks" type: outward "blocks"
  return null;
}

/**
 * When does the successor need its predecessor done? Work items (epics,
 * stories) need it when they start. Milestones and outcomes are points in
 * time, so they need it by their due date.
 */
export function needByDate(s: { level: string; startDate: string | null; dueDate: string | null }) {
  const pointInTime = ["outcome", "cpm", "ipm_intent", "ipm", "risk", "decision"].includes(s.level);
  return pointInTime ? (s.dueDate ?? s.startDate) : (s.startDate ?? s.dueDate);
}

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function analyzeDependencies(
  issues: IssueView[],
  links: Link[],
  changes: IssueChange[],
  cfg: AppConfig,
  today: string,
): Dependency[] {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const recentCutoff = new Date(Date.parse(today) - cfg.analysis.recentChangeDays * 86_400_000).toISOString();
  const changesByKey = new Map<string, IssueChange[]>();
  for (const c of changes) {
    if (c.detectedAt < recentCutoff) continue;
    if (!["startDate", "dueDate", "status"].includes(c.field)) continue;
    const arr = changesByKey.get(c.key) ?? [];
    arr.push(c);
    changesByKey.set(c.key, arr);
  }

  const out: Dependency[] = [];
  for (const l of links) {
    if (isContainsLink(l, cfg)) continue;
    const dir = linkDirection(l);
    if (!dir) continue;
    const pKey = dir === "from-first" ? l.fromKey : l.toKey;
    const sKey = dir === "from-first" ? l.toKey : l.fromKey;
    const p = byKey.get(pKey);
    const s = byKey.get(sKey);
    if (!p || !s) continue;
    if (!p.inScope && !s.inScope) continue;

    const direction = p.inScope && s.inScope ? "internal" : s.inScope ? "incoming" : "outgoing";
    const other = direction === "incoming" ? p : direction === "outgoing" ? s : p;

    const need = needByDate(s);
    const have = p.dueDate;
    let health: DepHealth;
    let reason: string;
    let slipDays: number | null = null;

    if (p.statusCategory === "done") {
      health = "done";
      reason = `${p.key} is done`;
    } else if (!have) {
      health = "unknown";
      reason = `${p.key} has no due date`;
    } else if (!need) {
      health = "unknown";
      reason = `${s.key} has no start or due date`;
    } else {
      slipDays = daysBetween(need, have);
      if (slipDays > 0) {
        health = "conflict";
        reason = `${p.key} due ${have}, ${slipDays}d after ${s.key} needs it (${need})`;
      } else if (have < today) {
        health = "overdue";
        reason = `${p.key} was due ${have} and is not done`;
      } else if (-slipDays < cfg.analysis.bufferDays) {
        health = "tight";
        reason = `Only ${-slipDays}d buffer before ${s.key} needs it (${need})`;
      } else {
        health = "ok";
        reason = `${-slipDays}d buffer`;
      }
    }

    out.push({
      predecessor: p,
      successor: s,
      link: l,
      direction,
      health,
      reason,
      slipDays,
      recentChanges: changesByKey.get(other.key) ?? [],
    });
  }
  return out.sort(
    (a, b) =>
      HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health) ||
      (b.slipDays ?? -999) - (a.slipDays ?? -999),
  );
}
