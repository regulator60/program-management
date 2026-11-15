import type { DatabaseSync } from "node:sqlite";
import { getConfig, type AppConfig } from "./config";
import { todayIso } from "./db";
import { analyzeDependencies, type Dependency } from "./dependencies";
import { buildTree, flattenTree, isLate, type TreeNode } from "./hierarchy";
import { listChanges, listIssues, listLinks, type IssueView } from "./store";
import type { IssueChange, Link } from "./types";

export type Model = {
  cfg: AppConfig;
  today: string;
  issues: IssueView[];
  byKey: Map<string, IssueView>;
  links: Link[];
  tree: TreeNode[];
  deps: Dependency[];
  changes: IssueChange[];
  /** Sub-track per key (own, else inherited from hierarchy parent). */
  subTrackOf: Map<string, string | null>;
  /** Platforms per key (own; for milestones/outcomes the roll-up of their descendants). */
  platformsOf: Map<string, string[]>;
  subTracks: string[];
  platforms: string[];
};

export function loadModel(db: DatabaseSync): Model {
  const cfg = getConfig(db);
  const today = todayIso();
  const issues = listIssues(db);
  const links = listLinks(db);
  const changes = listChanges(db);
  const tree = buildTree(issues, links, cfg, today);
  const deps = analyzeDependencies(issues, links, changes, cfg, today);

  const subTrackOf = new Map<string, string | null>();
  const platformsOf = new Map<string, string[]>();
  for (const n of flattenTree(tree)) {
    if (!subTrackOf.has(n.issue.key)) subTrackOf.set(n.issue.key, n.effectiveSubTrack);
    platformsOf.set(n.issue.key, n.issue.platforms.length ? n.issue.platforms : n.rollupPlatforms);
  }
  for (const i of issues) {
    if (!subTrackOf.has(i.key)) subTrackOf.set(i.key, i.subTrack);
    if (!platformsOf.has(i.key)) platformsOf.set(i.key, i.platforms);
  }

  const inScope = issues.filter((i) => i.inScope);
  const subTracks = [...new Set(inScope.map((i) => subTrackOf.get(i.key)).filter((x): x is string => !!x))].sort();
  const platforms = [...new Set(inScope.flatMap((i) => i.platforms))].sort();

  return {
    cfg,
    today,
    issues,
    byKey: new Map(issues.map((i) => [i.key, i])),
    links,
    tree,
    deps,
    changes,
    subTrackOf,
    platformsOf,
    subTracks,
    platforms,
  };
}

export type Filter = { subTrack?: string; platform?: string };

export function parseFilter(sp: Record<string, string | string[] | undefined>): Filter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  return { subTrack: one(sp.subtrack), platform: one(sp.platform) };
}

export function matchesFilter(m: Model, key: string, f: Filter) {
  if (f.subTrack && m.subTrackOf.get(key) !== f.subTrack) return false;
  if (f.platform && !(m.platformsOf.get(key) ?? []).includes(f.platform)) return false;
  return true;
}

// ---------------- Executive roll-up ----------------

export type Rag = "red" | "amber" | "green";

export type GroupReport = {
  name: string;
  rag: Rag;
  ragReasons: string[];
  milestones: { total: number; done: number; late: number };
  epics: { total: number; done: number; active: number };
  items: { total: number; done: number; late: number; active: number };
  deps: { conflict: number; overdue: number; tight: number; unknown: number };
  risks: { tier1: number; tier2: number; tier3: number };
  decisionsOpen: number;
  nextMilestone: IssueView | null;
  recentDateChanges: number;
};

export function groupReport(m: Model, name: string, f: Filter): GroupReport {
  const mine = m.issues.filter((i) => i.inScope && matchesFilter(m, i.key, f));
  const isMilestone = (i: IssueView) => i.level === "cpm" || i.level === "ipm" || i.level === "ipm_intent";
  const ms = mine.filter(isMilestone);
  const epics = mine.filter((i) => i.level === "epic");
  const items = mine.filter((i) => i.level === "story");
  const openRisks = mine.filter((i) => i.level === "risk" && i.statusCategory !== "done");
  const keys = new Set(mine.map((i) => i.key));
  const deps = m.deps.filter((d) => keys.has(d.successor.key) || keys.has(d.predecessor.key));
  const cnt = (h: string) => deps.filter((d) => d.health === h).length;

  const next =
    ms
      .filter((i) => i.statusCategory !== "done" && i.dueDate)
      .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))[0] ?? null;

  const r: GroupReport = {
    name,
    rag: "green",
    ragReasons: [],
    milestones: {
      total: ms.length,
      done: ms.filter((i) => i.statusCategory === "done").length,
      late: ms.filter((i) => isLate(i, m.today)).length,
    },
    epics: {
      total: epics.length,
      done: epics.filter((i) => i.statusCategory === "done").length,
      active: epics.filter((i) => i.statusCategory === "indeterminate").length,
    },
    items: {
      total: items.length,
      done: items.filter((i) => i.statusCategory === "done").length,
      late: items.filter((i) => isLate(i, m.today)).length,
      active: items.filter((i) => i.statusCategory === "indeterminate").length,
    },
    deps: { conflict: cnt("conflict"), overdue: cnt("overdue"), tight: cnt("tight"), unknown: cnt("unknown") },
    risks: {
      tier1: openRisks.filter((i) => i.tier === 1).length,
      tier2: openRisks.filter((i) => i.tier === 2).length,
      tier3: openRisks.filter((i) => i.tier === 3 || i.tier == null).length,
    },
    decisionsOpen: mine.filter((i) => i.level === "decision" && i.statusCategory !== "done").length,
    nextMilestone: next,
    recentDateChanges: deps.filter((d) => d.recentChanges.some((c) => c.field.endsWith("Date"))).length,
  };

  if (r.milestones.late) r.ragReasons.push(`${r.milestones.late} milestone(s) past due`);
  if (r.deps.conflict) r.ragReasons.push(`${r.deps.conflict} dependency date conflict(s)`);
  if (r.ragReasons.length) r.rag = "red";
  const amber: string[] = [];
  const overruns = flattenTree(m.tree).filter(
    (n) =>
      ["cpm", "ipm_intent", "ipm"].includes(n.issue.level) &&
      n.issue.inScope &&
      n.issue.statusCategory !== "done" &&
      matchesFilter(m, n.issue.key, f) &&
      !!n.rollup.latestChildDue &&
      !!n.issue.dueDate &&
      n.rollup.latestChildDue > n.issue.dueDate,
  ).length;
  if (overruns) amber.push(`${overruns} milestone plan(s) run past the due date`);
  if (r.items.late) amber.push(`${r.items.late} item(s) past due`);
  if (r.deps.overdue) amber.push(`${r.deps.overdue} overdue dependency(ies)`);
  if (r.deps.tight) amber.push(`${r.deps.tight} tight dependency(ies)`);
  if (r.deps.unknown) amber.push(`${r.deps.unknown} dependency(ies) without dates`);
  if (r.risks.tier1 + r.risks.tier2) amber.push(`${r.risks.tier1 + r.risks.tier2} open tier 1/2 risk(s)`);
  if (r.rag === "green" && amber.length) r.rag = "amber";
  r.ragReasons.push(...amber);
  return r;
}
