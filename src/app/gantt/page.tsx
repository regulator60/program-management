import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/client";
import { Gantt, type GanttRow } from "@/components/Gantt";
import { Empty, PageHeader } from "@/components/ui";
import { getDb } from "@/lib/db";
import { filterTree, flattenTree } from "@/lib/hierarchy";
import { loadModel, parseFilter } from "@/lib/model";

export const metadata = { title: "Timeline" };

export default function Page(props: PageProps<"/gantt">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <GanttPage searchParams={props.searchParams} />
    </Suspense>
  );
}

const ZOOM: Record<string, number> = { week: 14, month: 5, quarter: 2 };

async function GanttPage({ searchParams }: { searchParams: PageProps<"/gantt">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const depth = Number(sp.depth ?? 4);
  const dayWidth = ZOOM[String(sp.zoom ?? "month")] ?? 5;
  const showDeps = sp.deps !== "off";
  const m = loadModel(getDb());

  const nodes = flattenTree(filterTree(m.tree, f), depth);
  const rows: GanttRow[] = nodes.map((n) => ({ issue: n.issue, depth: n.depth }));
  const visible = new Set(rows.map((r) => r.issue.key));

  // Other-track items linked to visible rows get their own section so their bars & arrows show.
  const external = new Map<string, (typeof m.issues)[number]>();
  for (const d of m.deps) {
    if (visible.has(d.successor.key) && !visible.has(d.predecessor.key)) external.set(d.predecessor.key, d.predecessor);
    if (visible.has(d.predecessor.key) && !visible.has(d.successor.key)) external.set(d.successor.key, d.successor);
  }
  if (showDeps && external.size) {
    rows.push({ issue: rows[0]?.issue, depth: 0, section: "Linked dependencies (other tracks / not shown above)" });
    for (const i of [...external.values()].sort((a, b) => (a.dueDate ?? "9") < (b.dueDate ?? "9") ? -1 : 1)) {
      rows.push({ issue: i, depth: 0 });
    }
  }

  return (
    <>
      <PageHeader
        title="Timeline"
        eyebrow="Plan"
        subtitle="Bars run from start to due date; diamonds are milestone due dates. Green = done, red = past due. Arrows show dependencies, colored by health. Hover any bar for details."
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
          {
            name: "zoom",
            label: "Zoom",
            options: [
              { value: "", label: "Months" },
              { value: "week", label: "Weeks" },
              { value: "quarter", label: "Quarters" },
            ],
          },
          { name: "deps", label: "Dependencies", options: [{ value: "", label: "Show" }, { value: "off", label: "Hide" }] },
        ]}
      />
      {rows.length === 0 ? (
        <Empty>No items to chart.</Empty>
      ) : (
        <Gantt rows={rows} deps={m.deps} today={m.today} dayWidth={dayWidth} showDeps={showDeps} />
      )}
    </>
  );
}
