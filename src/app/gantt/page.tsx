import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/client";
import { Gantt, type GanttDep, type GanttItem, type Zoom } from "@/components/Gantt";
import { Empty, PageHeader } from "@/components/ui";
import { getDb } from "@/lib/db";
import { filterTree, flattenTree } from "@/lib/hierarchy";
import { depHref } from "@/lib/insights";
import { loadModel, parseFilter } from "@/lib/model";
import type { IssueView } from "@/lib/store";
import type { TreeNode } from "@/lib/hierarchy";

export const metadata = { title: "Timeline" };

export default function Page(props: PageProps<"/gantt">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <GanttPage searchParams={props.searchParams} />
    </Suspense>
  );
}

async function GanttPage({ searchParams }: { searchParams: PageProps<"/gantt">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const depth = Number(sp.depth ?? 4);
  const zoom = (["week", "month", "quarter"].includes(String(sp.zoom)) ? sp.zoom : "month") as Zoom;
  const showDeps = sp.deps !== "off";
  const m = loadModel(getDb());

  // Flatten the plan and record each row's nearest visible parent.
  const nodes = flattenTree(filterTree(m.tree, f), depth);
  const stack: string[] = [];
  const items: GanttItem[] = nodes.map((n) => {
    stack.length = n.depth;
    const parentKey = n.depth > 0 ? (stack[n.depth - 1] ?? null) : null;
    stack[n.depth] = n.issue.key;
    return toItem(n.issue, { depth: n.depth, parentKey, team: n.effectiveSubTrack, rollup: n.rollup });
  });
  const visible = new Set(items.map((r) => r.key));

  // Other-track items linked to visible rows get their own section so their bars & arrows show.
  const external = new Map<string, IssueView>();
  for (const d of m.deps) {
    if (visible.has(d.successor.key) && !visible.has(d.predecessor.key)) external.set(d.predecessor.key, d.predecessor);
    if (visible.has(d.predecessor.key) && !visible.has(d.successor.key)) external.set(d.successor.key, d.successor);
  }
  for (const i of [...external.values()].sort((a, b) => ((a.dueDate ?? "9") < (b.dueDate ?? "9") ? -1 : 1))) {
    items.push({ ...toItem(i, { depth: 0, parentKey: null, team: i.subTrack, rollup: null }), linked: true });
  }
  const shown = new Set(items.map((r) => r.key));
  const deps: GanttDep[] = m.deps
    .filter((d) => shown.has(d.predecessor.key) && shown.has(d.successor.key))
    .map((d) => ({ from: d.predecessor.key, to: d.successor.key, health: d.health, reason: d.reason, slipDays: d.slipDays, href: depHref(d) }));

  return (
    <>
      <PageHeader
        title="Timeline"
        eyebrow="Plan"
        subtitle="The plan over time: work as bars, milestones as diamonds, dependencies as arrows colored by health. Hover anything to see what it's connected to; click to pin its details."
      />
      <FilterBar
        subTracks={m.subTracks}
        platforms={m.platforms}
        extra={[
          {
            name: "depth",
            label: "Down to",
            options: [
              { value: "", label: "Epics" },
              { value: "1", label: "Critical path" },
              { value: "2", label: "Intent milestones" },
              { value: "3", label: "Interim milestones" },
              { value: "9", label: "Stories" },
            ],
          },
          { name: "deps", label: "Dependencies", options: [{ value: "", label: "Show" }, { value: "off", label: "Hide" }] },
        ]}
      />
      {items.length === 0 ? (
        <Empty>No items to chart.</Empty>
      ) : (
        <Gantt key={`${zoom}-${depth}`} items={items} deps={deps} today={m.today} initialZoom={zoom} showDeps={showDeps} />
      )}
    </>
  );
}

function toItem(
  i: IssueView,
  o: { depth: number; parentKey: string | null; team: string | null; rollup: TreeNode["rollup"] | null },
): GanttItem {
  return {
    key: i.key,
    summary: i.summary,
    level: i.level,
    depth: o.depth,
    parentKey: o.parentKey,
    start: i.startDate,
    due: i.dueDate,
    status: i.status,
    statusCategory: i.statusCategory,
    assignee: i.assignee,
    team: o.team,
    inScope: i.inScope,
    pending: i.pendingFields.length > 0,
    done: o.rollup?.done ?? 0,
    total: o.rollup?.total ?? 0,
    latestChildDue: o.rollup?.latestChildDue ?? null,
  };
}
