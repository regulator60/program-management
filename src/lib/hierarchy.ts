import type { AppConfig } from "./config";
import type { IssueView } from "./store";
import { LEVEL_RANK, type Link } from "./types";

export type TreeNode = {
  issue: IssueView;
  children: TreeNode[];
  depth: number;
  /** Sub-track inherited from the nearest ancestor when the issue has none. */
  effectiveSubTrack: string | null;
  /** Platforms on this node or any descendant. */
  rollupPlatforms: string[];
  rollup: {
    total: number; // descendants (not counting self)
    done: number;
    late: number; // descendants past due and not done
    /** Latest descendant due date. If later than this node's due date, the plan doesn't fit. */
    latestChildDue: string | null;
  };
};

export function isContainsLink(l: Link, cfg: AppConfig) {
  const verb = cfg.links.containsOutward.trim().toLowerCase();
  return l.outward.trim().toLowerCase() === verb || l.typeName.trim().toLowerCase() === verb;
}

export function isLate(i: { dueDate: string | null; statusCategory: string }, today: string) {
  return !!i.dueDate && i.dueDate < today && i.statusCategory !== "done";
}

/**
 * parent → children map from "contains" links plus Epic Link / parent.
 * Only links that go *down* the hierarchy (by level rank) are kept, which stops
 * a mis-linked issue from creating a cycle.
 */
export function childMap(issues: IssueView[], links: Link[], cfg: AppConfig) {
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const children = new Map<string, Set<string>>();
  const hasParent = new Set<string>();
  const add = (p: string, c: string) => {
    const pi = byKey.get(p);
    const ci = byKey.get(c);
    if (!pi || !ci || p === c) return;
    const pr = LEVEL_RANK[pi.level];
    const cr = LEVEL_RANK[ci.level];
    if (pr === undefined || cr === undefined || cr <= pr) return;
    if (!children.has(p)) children.set(p, new Set());
    children.get(p)!.add(c);
    hasParent.add(c);
  };
  for (const l of links) if (isContainsLink(l, cfg)) add(l.fromKey, l.toKey);
  for (const i of issues) if (i.parentKey) add(i.parentKey, i.key);
  return { children, hasParent, byKey };
}

export function buildTree(
  issues: IssueView[],
  links: Link[],
  cfg: AppConfig,
  today: string,
): TreeNode[] {
  const hierarchical = issues.filter((i) => LEVEL_RANK[i.level] !== undefined);
  const { children, hasParent, byKey } = childMap(hierarchical, links, cfg);

  const build = (key: string, depth: number, inherited: string | null, seen: Set<string>): TreeNode => {
    const issue = byKey.get(key)!;
    const effectiveSubTrack = issue.subTrack ?? inherited;
    const next = new Set(seen).add(key);
    const kids = [...(children.get(key) ?? [])]
      .filter((k) => !seen.has(k))
      .map((k) => build(k, depth + 1, effectiveSubTrack, next))
      .sort(compareNodes);

    const rollup = { total: 0, done: 0, late: 0, latestChildDue: null as string | null };
    const platforms = new Set(issue.platforms);
    for (const k of kids) {
      rollup.total += 1 + k.rollup.total;
      rollup.done += (k.issue.statusCategory === "done" ? 1 : 0) + k.rollup.done;
      rollup.late += (isLate(k.issue, today) ? 1 : 0) + k.rollup.late;
      for (const d of [k.issue.dueDate, k.rollup.latestChildDue]) {
        if (d && (!rollup.latestChildDue || d > rollup.latestChildDue)) rollup.latestChildDue = d;
      }
      k.rollupPlatforms.forEach((p) => platforms.add(p));
    }
    return {
      issue,
      children: kids,
      depth,
      effectiveSubTrack,
      rollupPlatforms: [...platforms].sort(),
      rollup,
    };
  };

  // Roots: in-scope outcomes/milestones/epics nobody contains. Out-of-scope issues
  // only appear under a parent; loose stories and intake tasks are not plan roots.
  return hierarchical
    .filter((i) => !hasParent.has(i.key) && i.inScope && !i.isIntake && i.level !== "story")
    .map((i) => build(i.key, 0, null, new Set()))
    .sort(compareNodes);
}

function compareNodes(a: TreeNode, b: TreeNode) {
  const ra = LEVEL_RANK[a.issue.level] ?? 9;
  const rb = LEVEL_RANK[b.issue.level] ?? 9;
  if (ra !== rb) return ra - rb;
  const da = a.issue.dueDate ?? "9999";
  const dbb = b.issue.dueDate ?? "9999";
  if (da !== dbb) return da < dbb ? -1 : 1;
  return a.issue.key.localeCompare(b.issue.key, undefined, { numeric: true });
}

export type TreeFilter = { subTrack?: string; platform?: string };

/** Keep nodes that match, or that have a matching descendant (so context is preserved). */
export function filterTree(nodes: TreeNode[], f: TreeFilter): TreeNode[] {
  if (!f.subTrack && !f.platform) return nodes;
  const matches = (n: TreeNode) =>
    (!f.subTrack || n.effectiveSubTrack === f.subTrack) &&
    (!f.platform || n.issue.platforms.includes(f.platform));
  const walk = (list: TreeNode[]): TreeNode[] =>
    list.flatMap((n) => {
      const kids = walk(n.children);
      if (matches(n) || kids.length) return [{ ...n, children: kids.length ? kids : matches(n) ? n.children : [] }];
      return [];
    });
  return walk(nodes);
}

export function flattenTree(nodes: TreeNode[], maxDepth = Infinity): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.depth < maxDepth) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/** Map key → effective sub-track for every issue reachable in the tree. */
export function effectiveSubTracks(nodes: TreeNode[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const n of flattenTree(nodes)) if (!m.has(n.issue.key)) m.set(n.issue.key, n.effectiveSubTrack);
  return m;
}
