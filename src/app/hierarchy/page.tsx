import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/client";
import { DateCell, Empty, KeyLink, LevelTag, PageHeader, Pending, Progress, StatusPill, fmtDate } from "@/components/ui";
import { getDb } from "@/lib/db";
import { filterTree, flattenTree, isLate, type TreeNode } from "@/lib/hierarchy";
import { loadModel, parseFilter } from "@/lib/model";

export default function Page(props: PageProps<"/hierarchy">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Hierarchy searchParams={props.searchParams} />
    </Suspense>
  );
}

const GRID = "grid grid-cols-[minmax(320px,1fr)_120px_120px_80px_80px_110px_110px] items-center gap-2";

async function Hierarchy({ searchParams }: { searchParams: PageProps<"/hierarchy">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const openDepth = Number(sp.open ?? 2);
  const m = loadModel(getDb());
  const tree = filterTree(m.tree, f);
  const issuesInTree = new Set(flattenTree(m.tree).map((n) => n.issue.key));
  const orphans = m.issues.filter(
    (i) => i.inScope && ["cpm", "ipm_intent", "ipm", "epic"].includes(i.level) && !issuesInTree.has(i.key),
  );
  const depFlags = new Map<string, number>();
  for (const d of m.deps) {
    if (!["conflict", "overdue"].includes(d.health)) continue;
    for (const k of [d.successor.key, d.predecessor.key]) depFlags.set(k, (depFlags.get(k) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Plan hierarchy"
        subtitle="Outcome → Critical path milestone → Interim milestone (Intent) → Interim milestone → Epic → Stories"
      />
      <FilterBar
        subTracks={m.subTracks}
        platforms={m.platforms}
        extra={[
          {
            name: "open",
            label: "Expand to",
            options: [
              { value: "0", label: "Outcomes" },
              { value: "1", label: "Critical path" },
              { value: "", label: "Intent milestones" },
              { value: "3", label: "Interim milestones" },
              { value: "4", label: "Epics" },
              { value: "9", label: "Everything" },
            ],
          },
        ]}
      />
      {tree.length === 0 ? (
        <Empty>
          Nothing matches. <Link href="/sync" className="text-accent underline">Load data</Link> or clear filters.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <div className="min-w-[1000px]">
            <div className={`${GRID} border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted`}>
              <div>Item</div>
              <div>Sub-track</div>
              <div>Platforms</div>
              <div>Start</div>
              <div>Due</div>
              <div>Status</div>
              <div>Progress</div>
            </div>
            {tree.map((n) => (
              <Node key={n.issue.key} n={n} openDepth={openDepth} today={m.today} depFlags={depFlags} />
            ))}
          </div>
        </div>
      )}
      {orphans.length > 0 && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <div className="mb-2 font-semibold">Not linked into the hierarchy ({orphans.length})</div>
          <p className="mb-2 text-xs text-muted">
            These in-scope milestones/epics have no &ldquo;contains&rdquo; parent, so they don&rsquo;t roll up to an outcome.
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {orphans.map((i) => (
              <li key={i.key} className="flex items-center gap-1">
                <LevelTag level={i.level} /> <KeyLink k={i.key} /> <span className="text-xs">{i.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function Node({
  n,
  openDepth,
  today,
  depFlags,
}: {
  n: TreeNode;
  openDepth: number;
  today: string;
  depFlags: Map<string, number>;
}) {
  const i = n.issue;
  const overrun = !!(n.rollup.latestChildDue && i.dueDate && n.rollup.latestChildDue > i.dueDate);
  const flags = depFlags.get(i.key);
  const row = (
    <div className={`${GRID} px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900`}>
      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: n.depth * 18 }}>
        <span className="w-3 text-muted">{n.children.length ? <span className="chev inline-block">▸</span> : ""}</span>
        <LevelTag level={i.level} />
        <KeyLink k={i.key} external={!i.inScope} />
        <span className={"truncate " + (i.level === "outcome" || i.level === "cpm" ? "font-medium" : "")} title={i.summary}>
          {i.summary}
          <Pending show={i.pendingFields.includes("summary")} />
        </span>
        {overrun && (
          <span title={`Children finish ${fmtDate(n.rollup.latestChildDue)} — after this item's due date`} className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700 dark:bg-red-900/50 dark:text-red-200">
            OVERRUN
          </span>
        )}
        {flags && (
          <Link href={`/dependencies?key=${i.key}`} title="Dependency conflicts" className="shrink-0 rounded bg-orange-100 px-1 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/50 dark:text-orange-200">
            DEP×{flags}
          </Link>
        )}
      </div>
      <div className="truncate text-xs text-muted">{n.effectiveSubTrack ?? "—"}</div>
      <div className="truncate text-xs text-muted" title={n.rollupPlatforms.join(", ")}>
        {(i.platforms.length ? i.platforms : n.rollupPlatforms).join(", ") || "—"}
      </div>
      <div className="text-xs"><DateCell date={i.startDate} pending={i.pendingFields.includes("startDate")} /></div>
      <div className="text-xs"><DateCell date={i.dueDate} late={isLate(i, today)} pending={i.pendingFields.includes("dueDate")} /></div>
      <div><StatusPill issue={i} /></div>
      <div>{n.children.length ? <Progress done={n.rollup.done} total={n.rollup.total} /> : null}</div>
    </div>
  );
  if (!n.children.length) return <div className="border-t border-line first:border-t-0">{row}</div>;
  return (
    <details open={n.depth < openDepth} className="group border-t border-line first:border-t-0 [&[open]>summary_.chev]:rotate-90">
      <summary className="cursor-pointer list-none">{row}</summary>
      {n.children.map((c) => (
        <Node key={c.issue.key} n={c} openDepth={openDepth} today={today} depFlags={depFlags} />
      ))}
    </details>
  );
}
