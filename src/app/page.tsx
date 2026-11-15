import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Flag,
  Gauge,
  ListChecks,
  Scale,
  ShieldAlert,
  Sparkles,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { FilterBar, PrintButton } from "@/components/client";
import { Roadmap, type MilestoneState } from "@/components/Roadmap";
import {
  Card,
  DateCell,
  Empty,
  HealthBadge,
  KeyLink,
  PageHeader,
  Progress,
  RagBadge,
  SEVERITY_LABEL,
  SeverityIcon,
  Stat,
  StatusPill,
  Table,
  Td,
  Th,
  ToneBadge,
  cx,
  fmtDate,
  relDays,
} from "@/components/ui";
import { getDb } from "@/lib/db";
import { flattenTree, isLate } from "@/lib/hierarchy";
import { buildInsights, depHref, headline, type Insight } from "@/lib/insights";
import { groupReport, loadModel, matchesFilter, parseFilter, type GroupReport } from "@/lib/model";
import { listActionItems, recentSyncs } from "@/lib/store";

export const metadata = { title: "Executive overview" };

export default function Page(props: PageProps<"/">) {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <Overview searchParams={props.searchParams} />
    </Suspense>
  );
}

function OverviewSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy>
      <div className="h-36 rounded-2xl bg-panel" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-panel" />
        ))}
      </div>
      <div className="h-80 rounded-xl bg-panel" />
    </div>
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
        <Empty icon={Sparkles}>
          No data yet. Go to{" "}
          <Link className="font-medium text-accent underline" href="/sync">
            Data &amp; Jira sync
          </Link>{" "}
          to connect Jira, import an export file, or load demo data.
        </Empty>
      </>
    );
  }

  const actionItems = listActionItems(db);
  const overall = groupReport(m, "Overall", f);
  const insights = buildInsights(m, f, actionItems);
  const summary = headline(insights, overall.rag, `The ${m.cfg.trackName} track`);
  const groups =
    by === "platform"
      ? m.platforms.filter((p) => !f.platform || p === f.platform).map((p) => groupReport(m, p, { ...f, platform: p }))
      : m.subTracks.filter((s) => !f.subTrack || s === f.subTrack).map((s) => groupReport(m, s, { ...f, subTrack: s }));

  // Milestone state for the roadmap: done / late / at risk / on track.
  const atRisk = new Set<string>();
  for (const i of insights) {
    if (i.threatens) atRisk.add(i.threatens.key);
    if (i.category === "milestone" && i.key && i.severity !== "good") atRisk.add(i.key);
  }
  const stateOf = (i: (typeof m.issues)[number]): MilestoneState =>
    i.statusCategory === "done" ? "done" : isLate(i, m.today) ? "late" : atRisk.has(i.key) ? "risk" : "ontrack";
  const milestones = m.issues.filter(
    (i) => i.inScope && ["cpm", "ipm_intent", "ipm"].includes(i.level) && matchesFilter(m, i.key, f),
  );
  const laneNames = [...new Set(milestones.map((i) => m.subTrackOf.get(i.key) ?? "Unassigned"))].sort();
  const lanes = laneNames.map((name) => ({
    name,
    milestones: milestones.filter((i) => (m.subTrackOf.get(i.key) ?? "Unassigned") === name),
  }));

  const cpms = flattenTree(m.tree).filter((n) => n.issue.level === "cpm" && matchesFilter(m, n.issue.key, f));
  const openActions =
    actionItems.filter((a) => a.status === "open").length +
    m.issues.filter((i) => i.isIntake && i.statusCategory !== "done").length;
  const overdueActions =
    actionItems.filter((a) => a.status === "open" && a.dueDate && a.dueDate < m.today).length +
    m.issues.filter((i) => i.isIntake && isLate(i, m.today)).length;
  const depWatch = m.deps
    .filter(
      (d) =>
        ["conflict", "overdue", "tight", "unknown"].includes(d.health) &&
        (matchesFilter(m, d.successor.key, f) || matchesFilter(m, d.predecessor.key, f)),
    )
    .slice(0, 6);
  const raid = m.issues
    .filter(
      (i) =>
        (i.level === "risk" || i.level === "decision") &&
        i.statusCategory !== "done" &&
        (i.tier === 1 || i.tier === 2) &&
        matchesFilter(m, i.key, f),
    )
    .sort((a, b) => (a.dueDate ?? "9") < (b.dueDate ?? "9") ? -1 : 1);
  const msPct = overall.milestones.total ? Math.round((overall.milestones.done / overall.milestones.total) * 100) : 0;
  const scope = [f.subTrack, f.platform].filter(Boolean).join(" · ");

  return (
    <>
      {/* Hero */}
      <section className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-panel p-6 shadow-card md:p-7">
        <div
          className={cx(
            "absolute inset-y-0 left-0 w-1.5",
            overall.rag === "red" ? "bg-critical" : overall.rag === "amber" ? "bg-warning" : "bg-good",
          )}
          aria-hidden
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent">
              {m.cfg.trackName} track · Executive overview{scope && <span className="text-muted">· {scope}</span>}
            </div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-fg">
              Overall status: <span className="whitespace-nowrap">{overall.rag === "green" ? "on track" : overall.rag === "amber" ? "at risk" : "off track"}</span>
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{summary}</p>
            <p className="mt-3 text-xs text-muted">
              As of {fmtDate(m.today)}
              {lastSync && <> · data last loaded {fmtDate(lastSync.finished_at?.slice(0, 10))} from {lastSync.source}</>}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <RagBadge rag={overall.rag} />
            <PrintButton />
          </div>
        </div>
      </section>

      <FilterBar
        subTracks={m.subTracks}
        platforms={m.platforms}
        extra={[{ name: "by", label: "Group by", options: [{ value: "", label: "Sub-track" }, { value: "platform", label: "Platform" }] }]}
      />

      {/* KPIs */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Milestones complete" value={`${msPct}%`} icon={Flag} hint={`${overall.milestones.done} of ${overall.milestones.total}`} href="/hierarchy" />
        <Stat label="Past-due milestones" value={overall.milestones.late} icon={CalendarClock} tone={overall.milestones.late ? "red" : "green"} hint={overall.milestones.late ? "Needs recovery plan" : "None"} href="/hierarchy" />
        <Stat label="Dependency conflicts" value={overall.deps.conflict} icon={Waypoints} tone={overall.deps.conflict ? "red" : "green"} hint={`${overall.deps.tight} tight · ${overall.deps.unknown} undated`} href="/dependencies?health=issues" />
        <Stat label="Tier 1–2 risks" value={overall.risks.tier1 + overall.risks.tier2} icon={ShieldAlert} tone={overall.risks.tier1 + overall.risks.tier2 ? "amber" : "green"} hint={`${overall.risks.tier3} tier 3 open`} href="/raid" />
        <Stat label="Open decisions" value={overall.decisionsOpen} icon={Scale} hint="Across all tiers" href="/raid" />
        <Stat label="Open action items" value={openActions} icon={ListChecks} tone={overdueActions ? "amber" : undefined} hint={overdueActions ? `${overdueActions} overdue` : "None overdue"} href="/actions" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <InsightsCard insights={insights} />
        <Card title="Critical path milestones" icon={Gauge} subtitle="Progress of everything planned under each milestone" flush>
          <Table>
            <thead>
              <tr>
                <Th>Milestone</Th>
                <Th>Due</Th>
                <Th>Progress</Th>
              </tr>
            </thead>
            <tbody>
              {cpms.map((n) => {
                const overrun = !!(n.rollup.latestChildDue && n.issue.dueDate && n.rollup.latestChildDue > n.issue.dueDate);
                const st = stateOf(n.issue);
                return (
                  <tr key={n.issue.key}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <KeyLink k={n.issue.key} />
                        {st === "late" ? <ToneBadge tone="critical">Past due</ToneBadge> : st === "risk" ? <ToneBadge tone="warning">At risk</ToneBadge> : st === "done" ? <ToneBadge tone="good">Done</ToneBadge> : null}
                      </div>
                      <div className="mt-0.5 font-medium text-fg">{n.issue.summary}</div>
                      <div className="text-xs text-muted">
                        {n.effectiveSubTrack ?? "No sub-track"}
                        {overrun && <span className="text-critical-ink"> · work runs to {fmtDate(n.rollup.latestChildDue, false)}</span>}
                      </div>
                    </Td>
                    <Td>
                      <DateCell date={n.issue.dueDate} late={isLate(n.issue, m.today)} />
                      <div className="text-xs text-muted">{relDays(n.issue.dueDate, m.today)}</div>
                    </Td>
                    <Td>
                      <Progress done={n.rollup.done} total={n.rollup.total} width="w-28" />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card
        title="Milestone roadmap"
        icon={CalendarClock}
        subtitle="Next 120 days by sub-track. Hover or tab to a marker for details."
        className="mb-6"
        actions={<Link href="/gantt" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Full timeline <ArrowRight className="h-3.5 w-3.5" /></Link>}
      >
        <Roadmap lanes={lanes} today={m.today} stateOf={stateOf} />
      </Card>

      <div className="mb-3 flex items-end justify-between">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Status by {by === "platform" ? "platform" : "sub-track"}</h2>
        <span className="text-xs text-muted">Click a card to open that team&rsquo;s S0 weekly review</span>
      </div>
      {groups.length === 0 ? (
        <Empty>No {by === "platform" ? "platform (Domain:) labels" : "sub-tracks"} found. Check label settings.</Empty>
      ) : (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <GroupCard key={g.name} g={g} by={by} today={m.today} />
          ))}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card
          title="Dependency watch"
          icon={Waypoints}
          flush
          actions={<Link href="/dependencies" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">All dependencies <ArrowRight className="h-3.5 w-3.5" /></Link>}
        >
          {depWatch.length === 0 ? (
            <p className="p-5 text-sm text-muted">No dependency issues.</p>
          ) : (
            <ul className="divide-y divide-line">
              {depWatch.map((d) => (
                <li key={`${d.predecessor.key}-${d.successor.key}`}>
                  <Link href={depHref(d)} className="flex items-start gap-3 px-5 py-3 hover:bg-panel-2">
                    <HealthBadge health={d.health} />
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                        <span className={d.predecessor.inScope ? "text-accent" : "text-muted"}>{d.predecessor.key}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-muted" aria-label="needed by" />
                        <span className={d.successor.inScope ? "text-accent" : "text-muted"}>{d.successor.key}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-ink-2">{d.reason}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Tier 1–2 risks & decisions"
          icon={ShieldAlert}
          flush
          actions={<Link href="/raid" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">RAID log <ArrowRight className="h-3.5 w-3.5" /></Link>}
        >
          {raid.length === 0 ? (
            <p className="p-5 text-sm text-muted">No open multi-track risks or decisions.</p>
          ) : (
            <ul className="divide-y divide-line">
              {raid.map((r) => (
                <li key={r.key} className="flex items-start gap-3 px-5 py-3">
                  <ToneBadge tone={r.level === "risk" ? (r.tier === 1 ? "critical" : "serious") : "info"} icon={r.level === "decision" ? Scale : undefined}>
                    {r.level === "risk" ? "Risk" : "Decision"} · T{r.tier}
                  </ToneBadge>
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="font-medium text-fg">{r.summary}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
                      <KeyLink k={r.key} />
                      <span>{r.assignee ?? "Unassigned"}</span>
                      <span>· due {fmtDate(r.dueDate, false)} ({relDays(r.dueDate, m.today)})</span>
                    </div>
                  </div>
                  <StatusPill issue={r} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function InsightsCard({ insights }: { insights: Insight[] }) {
  const top = insights.filter((i) => i.severity !== "good").slice(0, 7);
  const rest = insights.filter((i) => i.severity !== "good").slice(7);
  const wins = insights.filter((i) => i.severity === "good");
  const Row = ({ i }: { i: Insight }) => (
    <li>
      <Link href={i.href} className="group flex items-start gap-3 px-5 py-3 transition hover:bg-panel-2">
        <SeverityIcon severity={i.severity} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg">{i.title}</div>
          <div className="mt-0.5 line-clamp-2 text-xs text-ink-2">{i.detail}</div>
          {i.threatens && i.severity !== "good" && (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-critical-soft px-1.5 py-0.5 text-[11px] font-medium text-critical-ink">
              <Flag className="h-3 w-3" aria-hidden /> Threatens {i.threatens.key}
            </div>
          )}
        </div>
        <span className="mt-0.5 hidden text-[11px] font-semibold uppercase tracking-wide text-muted sm:inline">{SEVERITY_LABEL[i.severity]}</span>
        <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" aria-hidden />
      </Link>
    </li>
  );
  return (
    <Card title="What needs attention" icon={Sparkles} subtitle="Ranked automatically from dates, dependencies, risks and actions" flush>
      {top.length === 0 ? (
        <p className="p-5 text-sm text-muted">Nothing needs attention right now.</p>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((i) => (
            <Row key={i.id} i={i} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <details className="border-t border-line">
          <summary className="cursor-pointer px-5 py-2.5 text-xs font-medium text-accent hover:bg-panel-2">Show {rest.length} more</summary>
          <ul className="divide-y divide-line border-t border-line">
            {rest.map((i) => (
              <Row key={i.id} i={i} />
            ))}
          </ul>
        </details>
      )}
      {wins.length > 0 && (
        <div className="border-t border-line px-5 py-3 text-xs text-ink-2">
          <span className="font-semibold text-good-ink">Recently completed:</span> {wins.map((w) => w.key).join(", ")}
        </div>
      )}
    </Card>
  );
}

function GroupCard({ g, by, today }: { g: GroupReport; by: string; today: string }) {
  const href = `/s0/${by === "platform" ? "platform" : "subtrack"}/${encodeURIComponent(g.name)}`;
  const issues = g.deps.conflict + g.deps.overdue;
  return (
    <Link href={href} className="group flex flex-col rounded-xl border border-line bg-panel p-5 shadow-card transition hover:border-line-strong hover:shadow-pop">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-fg">{g.name}</h3>
        <RagBadge rag={g.rag} />
      </div>
      <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
        <dt className="text-xs text-muted">Milestones</dt>
        <dd className="tabular flex items-center gap-2 font-medium text-fg">
          {g.milestones.done}/{g.milestones.total} done
          {g.milestones.late > 0 && <ToneBadge tone="critical">{g.milestones.late} late</ToneBadge>}
        </dd>
        <dt className="text-xs text-muted">Epics</dt>
        <dd><Progress done={g.epics.done} active={g.epics.active} total={g.epics.total} width="w-full max-w-40" /></dd>
        <dt className="text-xs text-muted">Stories</dt>
        <dd><Progress done={g.items.done} active={g.items.active} total={g.items.total} width="w-full max-w-40" /></dd>
        <dt className="text-xs text-muted">Dependencies</dt>
        <dd className="text-xs text-ink-2">
          {issues || g.deps.tight || g.deps.unknown ? (
            <span className="flex flex-wrap gap-1">
              {g.deps.conflict > 0 && <ToneBadge tone="critical">{g.deps.conflict} conflict</ToneBadge>}
              {g.deps.overdue > 0 && <ToneBadge tone="serious">{g.deps.overdue} overdue</ToneBadge>}
              {g.deps.tight > 0 && <ToneBadge tone="warning">{g.deps.tight} tight</ToneBadge>}
              {g.deps.unknown > 0 && <ToneBadge tone="neutral">{g.deps.unknown} undated</ToneBadge>}
            </span>
          ) : (
            "All on track"
          )}
        </dd>
        <dt className="text-xs text-muted">Risks</dt>
        <dd className="tabular text-xs text-ink-2">
          T1 {g.risks.tier1} · T2 {g.risks.tier2} · T3 {g.risks.tier3}
        </dd>
      </dl>
      <div className="mt-4 border-t border-line pt-3 text-xs">
        {g.nextMilestone ? (
          <>
            <span className="text-muted">Next milestone · </span>
            <span className="font-medium text-fg">{g.nextMilestone.summary}</span>
            <span className="text-muted"> · {fmtDate(g.nextMilestone.dueDate, false)} ({relDays(g.nextMilestone.dueDate, today)})</span>
          </>
        ) : (
          <span className="text-muted">No upcoming milestones</span>
        )}
      </div>
      {g.ragReasons.length > 0 && <div className="mt-2 text-xs text-ink-2">{g.ragReasons.slice(0, 2).join(" · ")}</div>}
    </Link>
  );
}
