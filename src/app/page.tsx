import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar } from "@/components/client";
import {
  Card,
  DateCell,
  Empty,
  HealthBadge,
  KeyLink,
  LevelTag,
  PageHeader,
  Progress,
  RagDot,
  Stat,
  StatusPill,
  Table,
  Td,
  Th,
  fmtDate,
} from "@/components/ui";
import { getDb } from "@/lib/db";
import { flattenTree, isLate } from "@/lib/hierarchy";
import { groupReport, loadModel, matchesFilter, parseFilter } from "@/lib/model";
import { listActionItems, recentSyncs } from "@/lib/store";

export default function Page(props: PageProps<"/">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Overview searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Overview({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const by = sp.by === "platform" ? "platform" : "subtrack";
  const db = getDb();
  const m = loadModel(db);
  const lastSync = recentSyncs(db, 1)[0];

  if (!m.issues.some((i) => i.inScope)) {
    return (
      <>
        <PageHeader title="Executive overview" />
        <Empty>
          No data yet. Go to <Link className="text-accent underline" href="/sync">Data &amp; Jira sync</Link> to
          connect Jira, import an export file, or load demo data.
        </Empty>
      </>
    );
  }

  const overall = groupReport(m, "Overall", f);
  const groups =
    by === "platform"
      ? m.platforms.filter((p) => !f.platform || p === f.platform).map((p) => groupReport(m, p, { ...f, platform: p }))
      : m.subTracks.filter((s) => !f.subTrack || s === f.subTrack).map((s) => groupReport(m, s, { ...f, subTrack: s }));

  const nodes = flattenTree(m.tree);
  const cpms = nodes.filter((n) => n.issue.level === "cpm" && matchesFilter(m, n.issue.key, f));
  const in30 = new Date(Date.parse(m.today) + 30 * 86_400_000).toISOString().slice(0, 10);
  const upcoming = m.issues
    .filter(
      (i) =>
        i.inScope &&
        ["cpm", "ipm_intent", "ipm"].includes(i.level) &&
        i.statusCategory !== "done" &&
        i.dueDate &&
        i.dueDate <= in30 &&
        matchesFilter(m, i.key, f),
    )
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const depAlerts = m.deps
    .filter(
      (d) =>
        ["conflict", "overdue", "tight"].includes(d.health) &&
        (matchesFilter(m, d.successor.key, f) || matchesFilter(m, d.predecessor.key, f)),
    )
    .slice(0, 8);
  const changed = m.deps.filter(
    (d) => d.recentChanges.some((c) => c.field.endsWith("Date")) && (matchesFilter(m, d.successor.key, f) || matchesFilter(m, d.predecessor.key, f)),
  );
  const topRisks = m.issues.filter(
    (i) => i.level === "risk" && i.statusCategory !== "done" && (i.tier === 1 || i.tier === 2) && matchesFilter(m, i.key, f),
  );
  const openActions =
    listActionItems(db).filter((a) => a.status === "open").length +
    m.issues.filter((i) => i.isIntake && i.statusCategory !== "done").length;

  return (
    <>
      <PageHeader
        title={`${m.cfg.trackName} track — executive overview`}
        subtitle={
          <>
            As of {fmtDate(m.today)}
            {lastSync && <> · last data load {fmtDate(lastSync.finished_at?.slice(0, 10))} ({lastSync.source})</>}
          </>
        }
        actions={
          <span className="flex items-center gap-2 text-sm">
            Overall <RagDot rag={overall.rag} label />
          </span>
        }
      />
      <FilterBar
        subTracks={m.subTracks}
        platforms={m.platforms}
        extra={[{ name: "by", label: "Group by", options: [{ value: "", label: "Sub-track" }, { value: "platform", label: "Platform" }] }]}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Milestones done" value={`${overall.milestones.done}/${overall.milestones.total}`} />
        <Stat label="Late milestones" value={overall.milestones.late} tone={overall.milestones.late ? "red" : "green"} />
        <Stat label="Dependency conflicts" value={overall.deps.conflict} tone={overall.deps.conflict ? "red" : "green"} />
        <Stat label="Tier 1/2 risks open" value={overall.risks.tier1 + overall.risks.tier2} tone={overall.risks.tier1 + overall.risks.tier2 ? "amber" : "green"} />
        <Stat label="Decisions open" value={overall.decisionsOpen} />
        <Stat label="Action items open" value={openActions} />
      </div>

      <Card title={`Status by ${by === "platform" ? "platform" : "sub-track"}`} className="mb-6">
        {groups.length === 0 ? (
          <p className="text-sm text-muted">
            No {by === "platform" ? "platform (Domain:) labels" : "sub-tracks"} found. Check label settings.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{by === "platform" ? "Platform" : "Sub-track"}</Th>
                <Th>RAG</Th>
                <Th>Milestones</Th>
                <Th>Epics</Th>
                <Th>Items</Th>
                <Th>Dependencies</Th>
                <Th>Open risks T1/T2/T3</Th>
                <Th>Next milestone</Th>
                <Th>Why</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name}>
                  <Td className="font-medium">
                    <Link
                      className="hover:underline"
                      href={`/hierarchy?${by === "platform" ? "platform" : "subtrack"}=${encodeURIComponent(g.name)}`}
                    >
                      {g.name}
                    </Link>
                  </Td>
                  <Td><RagDot rag={g.rag} /></Td>
                  <Td className="whitespace-nowrap tabular-nums">
                    {g.milestones.done}/{g.milestones.total}
                    {g.milestones.late > 0 && <span className="ml-1 text-red-600">({g.milestones.late} late)</span>}
                  </Td>
                  <Td><Progress done={g.epics.done} total={g.epics.total} /></Td>
                  <Td>
                    <Progress done={g.items.done} total={g.items.total} />
                    {g.items.late > 0 && <span className="text-xs text-red-600">{g.items.late} late</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">
                    {g.deps.conflict > 0 && <span className="mr-2 text-red-600">{g.deps.conflict} conflict</span>}
                    {g.deps.overdue > 0 && <span className="mr-2 text-orange-600">{g.deps.overdue} overdue</span>}
                    {g.deps.tight > 0 && <span className="mr-2 text-amber-600">{g.deps.tight} tight</span>}
                    {g.deps.unknown > 0 && <span className="text-muted">{g.deps.unknown} no date</span>}
                    {!g.deps.conflict && !g.deps.overdue && !g.deps.tight && !g.deps.unknown && <span className="text-muted">—</span>}
                  </Td>
                  <Td className="tabular-nums">{g.risks.tier1}/{g.risks.tier2}/{g.risks.tier3}</Td>
                  <Td className="text-xs">
                    {g.nextMilestone ? (
                      <>
                        <KeyLink k={g.nextMilestone.key} /> {fmtDate(g.nextMilestone.dueDate)}
                        <div className="text-muted">{g.nextMilestone.summary}</div>
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="text-xs text-muted">{g.ragReasons.join("; ") || "On track"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Critical path milestones">
          <Table>
            <thead>
              <tr>
                <Th>Key</Th>
                <Th>Milestone</Th>
                <Th>Due</Th>
                <Th>Status</Th>
                <Th>Progress</Th>
              </tr>
            </thead>
            <tbody>
              {cpms.map((n) => {
                const overrun = !!(n.rollup.latestChildDue && n.issue.dueDate && n.rollup.latestChildDue > n.issue.dueDate);
                return (
                  <tr key={n.issue.key}>
                    <Td><KeyLink k={n.issue.key} /></Td>
                    <Td>
                      {n.issue.summary}
                      <div className="text-xs text-muted">{n.effectiveSubTrack ?? "No sub-track"}</div>
                      {overrun && (
                        <div className="text-xs text-red-600">
                          Child work finishes {fmtDate(n.rollup.latestChildDue)}, after this milestone
                        </div>
                      )}
                    </Td>
                    <Td><DateCell date={n.issue.dueDate} late={isLate(n.issue, m.today)} /></Td>
                    <Td><StatusPill issue={n.issue} /></Td>
                    <Td>
                      <Progress done={n.rollup.done} total={n.rollup.total} />
                      {n.rollup.late > 0 && <span className="text-xs text-red-600">{n.rollup.late} late below</span>}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>

        <Card title="Milestones due in the next 30 days">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">Nothing due.</p>
          ) : (
            <Table>
              <tbody>
                {upcoming.map((i) => (
                  <tr key={i.key}>
                    <Td><LevelTag level={i.level} /></Td>
                    <Td><KeyLink k={i.key} /></Td>
                    <Td>{i.summary}</Td>
                    <Td><DateCell date={i.dueDate} late={isLate(i, m.today)} /></Td>
                    <Td><StatusPill issue={i} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card title="Dependency alerts" actions={<Link href="/dependencies" className="text-xs text-accent hover:underline">All dependencies →</Link>}>
          {depAlerts.length === 0 ? (
            <p className="text-sm text-muted">No date conflicts.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {depAlerts.map((d) => (
                <li key={`${d.predecessor.key}-${d.successor.key}`} className="flex flex-wrap items-baseline gap-2">
                  <HealthBadge health={d.health} />
                  <KeyLink k={d.predecessor.key} external={!d.predecessor.inScope} />
                  <span className="text-muted">→</span>
                  <KeyLink k={d.successor.key} external={!d.successor.inScope} />
                  <span className="text-xs text-muted">{d.reason}</span>
                </li>
              ))}
            </ul>
          )}
          {changed.length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <div className="mb-1 text-xs font-semibold uppercase text-muted">Dependency dates changed recently</div>
              <ul className="space-y-1 text-sm">
                {changed.slice(0, 6).map((d) => {
                  const other = d.direction === "outgoing" ? d.successor : d.predecessor;
                  const c = d.recentChanges.find((x) => x.field.endsWith("Date"))!;
                  return (
                    <li key={`${d.predecessor.key}-${d.successor.key}-c`}>
                      <KeyLink k={other.key} external={!other.inScope} /> {c.field === "dueDate" ? "due" : "start"}{" "}
                      {fmtDate(c.oldValue)} → <b>{fmtDate(c.newValue)}</b>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>

        <Card title="Tier 1 & 2 risks" actions={<Link href="/raid" className="text-xs text-accent hover:underline">RAID log →</Link>}>
          {topRisks.length === 0 ? (
            <p className="text-sm text-muted">No open multi-track risks.</p>
          ) : (
            <Table>
              <tbody>
                {topRisks.map((r) => (
                  <tr key={r.key}>
                    <Td className="whitespace-nowrap text-xs font-semibold">Tier {r.tier}</Td>
                    <Td><KeyLink k={r.key} /></Td>
                    <Td>{r.summary}</Td>
                    <Td className="text-xs text-muted">{r.assignee ?? "Unassigned"}</Td>
                    <Td><DateCell date={r.dueDate} late={isLate(r, m.today)} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
