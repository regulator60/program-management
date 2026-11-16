import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Circle,
  Flag,
  History,
  Link2,
  ListChecks,
  MessageSquareText,
  NotebookPen,
  Plus,
  Scale,
  ShieldAlert,
  Users,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { addActionItemAction, updateActionItemAction, updateAssignmentAction } from "@/app/actions";
import { PrintButton } from "@/components/client";
import {
  Button,
  Card,
  DateCell,
  Empty,
  HealthBadge,
  KeyLink,
  LevelTag,
  PageHeader,
  Progress,
  RagBadge,
  SeverityIcon,
  Stat,
  StatusPill,
  ToneBadge,
  cx,
  fmtDate,
  inputCls,
  relDays,
} from "@/components/ui";
import { getDb } from "@/lib/db";
import { flattenTree, isLate } from "@/lib/hierarchy";
import { depHref } from "@/lib/insights";
import { buildBrief } from "@/lib/brief";
import { Briefing } from "@/components/Briefing";
import { loadModel } from "@/lib/model";
import { allScopes, listProgramActions } from "@/lib/programActions";
import { buildS0, type AgendaItem } from "@/lib/s0";
import { listActionItems, listAssignments, listItemUpdates, listNotes } from "@/lib/store";
import { Combobox, MultiCombobox } from "@/components/combobox";
import { issueOptions, peopleOptions } from "@/lib/options";
import { LastUpdate, UpdateComposer } from "@/components/updates";
import { parseScope, scopeId, type Scope } from "@/lib/types";

/** S0 view for one team; `scopeParam` is "subtrack:Name" / "platform:Name", or null for the first team. */
export function S0View({ scope }: { scope: Promise<string | null> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <S0Page scopeParam={scope} />
    </Suspense>
  );
}

export const s0Href = (s: Scope) => `/s0/${s.kind}/${encodeURIComponent(s.name)}`;

const SECTION_LABEL: Record<AgendaItem["section"], string> = {
  wins: "Wins since last week",
  discuss: "Discuss and decide",
  review: "Risks & decisions to review",
  asks: "Program asks for this team",
  actions: "Action items",
  changes: "What moved this week",
};

async function S0Page({ scopeParam }: { scopeParam: Promise<string | null> }) {
  await connection();
  const requested = await scopeParam;
  const db = getDb();
  const m = loadModel(db);
  const scopes = allScopes(m);
  if (!scopes.length) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="S0 weekly review" />
        <Empty icon={Users}>
          No sub-tracks or platforms yet. Load data on <Link href="/sync" className="text-accent underline">Data &amp; Jira sync</Link>.
        </Empty>
      </>
    );
  }
  const scope: Scope = parseScope(requested) ?? scopes[0];
  const actions = listActionItems(db);
  const s0 = buildS0(m, scope, {
    actions,
    programs: listProgramActions(db, m, actions),
    updates: listItemUpdates(db),
    notes: listNotes(db),
  });
  const people = peopleOptions(m, actions, listAssignments(db));
  const brief = buildBrief(
    m,
    s0.filter,
    { actions, notes: listNotes(db), updates: listItemUpdates(db), programs: listProgramActions(db, m, actions) },
    { rag: s0.report.rag, subject: scope.name },
  );
  const scopeKey = scopeId(scope);
  const back = s0Href(scope);
  const nodes = new Map(flattenTree(m.tree).map((n) => [n.issue.key, n]));
  const atRisk = new Set(s0.insights.flatMap((i) => [i.key, i.threatens?.key]).filter(Boolean) as string[]);
  const openAsks = s0.programAsks.filter((a) => a.assignment.status !== "done");
  const openActions = s0.teamActions.filter((a) => a.status === "open");
  const overdueActions = openActions.filter((a) => a.dueDate && a.dueDate < m.today);
  const agendaSections = (Object.keys(SECTION_LABEL) as AgendaItem["section"][])
    .map((section) => ({ section, items: s0.agenda.filter((a) => a.section === section) }))
    .filter((g) => g.items.length);
  const number = new Map(agendaSections.flatMap((g) => g.items).map((a, i) => [a.id, i + 1]));

  return (
    <>
      <ScopeTabs scopes={scopes} active={scope} />

      <section className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-panel p-6 shadow-card">
        <div
          className={cx("absolute inset-y-0 left-0 w-1.5", s0.report.rag === "red" ? "bg-critical" : s0.report.rag === "amber" ? "bg-warning" : "bg-good")}
          aria-hidden
        />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-accent">
              S0 weekly review · {scope.kind === "subtrack" ? "Sub-track" : "Platform"}
            </div>
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-fg">{scope.name}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{brief.summary}</p>
            <p className="mt-2 text-xs text-muted">
              Weekly status review · Week of{" "}
              {new Date(m.today + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <RagBadge rag={s0.report.rag} />
            <PrintButton />
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Milestones done" value={`${s0.report.milestones.done}/${s0.report.milestones.total}`} icon={Flag} hint={s0.report.milestones.late ? `${s0.report.milestones.late} late` : "None late"} tone={s0.report.milestones.late ? "red" : undefined} />
        <Stat label="Due in 6 weeks" value={s0.milestones.filter((i) => i.dueDate && i.dueDate <= new Date(Date.parse(m.today) + 42 * 86_400_000).toISOString().slice(0, 10)).length} icon={CalendarClock} hint="Open milestones" />
        <Stat label="Dependency issues" value={s0.report.deps.conflict + s0.report.deps.overdue} icon={Waypoints} tone={s0.report.deps.conflict + s0.report.deps.overdue ? "red" : "green"} hint={`${s0.report.deps.tight} tight · ${s0.report.deps.unknown} undated`} />
        <Stat label="Open risks" value={s0.risks.length} icon={ShieldAlert} hint={`${s0.decisions.length} open decision${s0.decisions.length === 1 ? "" : "s"}`} />
        <Stat label="Program asks open" value={openAsks.length} icon={Flag} tone={openAsks.length ? "amber" : "green"} hint={`${s0.programAsks.length - openAsks.length} done`} />
        <Stat label="Action items open" value={openActions.length} icon={ListChecks} tone={overdueActions.length ? "amber" : undefined} hint={overdueActions.length ? `${overdueActions.length} overdue` : "None overdue"} />
      </div>

      <div className="mb-6">
        <Briefing brief={brief} perColumn={3} title="This week at a glance" />
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card title="Agenda" icon={MessageSquareText} subtitle="Generated from this week's data. Work top to bottom; capture actions as you go." flush>
          {agendaSections.length === 0 ? (
            <p className="p-5 text-sm text-muted">Nothing flagged. Quick status round and close.</p>
          ) : (
            agendaSections.map((g) => (
              <div key={g.section} className="border-b border-line last:border-b-0">
                <div className="bg-panel-2 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-2">{SECTION_LABEL[g.section]}</div>
                <ol className="divide-y divide-line">
                  {g.items.map((a) => (
                    <li key={a.id}>
                      <Link href={a.href} className="group flex items-start gap-3 px-5 py-3 hover:bg-panel-2">
                        <span className="tabular mt-0.5 w-5 shrink-0 text-right text-xs font-semibold text-muted">{number.get(a.id)}.</span>
                        <SeverityIcon severity={a.severity} className="mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-fg">{a.title}</div>
                          <div className="mt-0.5 text-sm italic text-ink-2">{a.question}</div>
                          {a.basis && <div className="mt-0.5 text-[11px] text-muted">Based on: {a.basis}</div>}
                        </div>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted opacity-0 group-hover:opacity-100" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            ))
          )}
        </Card>

        <div className="grid content-start gap-6">
          <Card title="Capture an action" icon={Plus} subtitle={`Owned by ${scope.name}. Mention a Jira key to link it.`}>
            <form action={addActionItemAction} className="grid gap-2">
              <input type="hidden" name="back" value={back} />
              <input type="hidden" name={scope.kind === "subtrack" ? "subTrack" : "platform"} value={scope.name} />
              <input name="text" required placeholder="e.g. Ask View Account to confirm VIEW-50 date" className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <Combobox name="owner" options={people} placeholder="Owner" />
                <input name="dueDate" type="date" className={inputCls} />
              </div>
              <MultiCombobox name="links" options={issueOptions(m)} placeholder="Link to milestones, dependencies, risks… (optional)" />
              <div><Button type="submit">Add action</Button></div>
            </form>
          </Card>
          <Card title="Changed this week" icon={History} flush>
            {s0.changes.length === 0 ? (
              <p className="p-5 text-sm text-muted">No date or status changes in the last 7 days.</p>
            ) : (
              <ul className="divide-y divide-line">
                {s0.changes.slice(0, 10).map((c) => {
                  const isDate = c.field.endsWith("Date");
                  const later = isDate && c.oldValue && c.newValue && c.newValue > c.oldValue;
                  return (
                    <li key={c.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                      <KeyLink k={c.key} external={!c.issue?.inScope} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-fg">{c.issue?.summary}</div>
                        <div className="text-xs text-ink-2">
                          {c.field === "dueDate" ? "Due" : c.field === "startDate" ? "Start" : "Status"}:{" "}
                          {isDate ? fmtDate(c.oldValue, false) : c.oldValue} → <b className={later ? "text-critical-ink" : ""}>{isDate ? fmtDate(c.newValue, false) : c.newValue}</b>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="Upcoming milestones" icon={CalendarClock} subtitle="Late, due in the next 6 weeks, or the next three coming up" flush>
          {s0.milestones.length === 0 ? (
            <p className="p-5 text-sm text-muted">No open milestones.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s0.milestones.map((i) => {
                const node = nodes.get(i.key);
                const late = isLate(i, m.today);
                return (
                  <li key={i.key} className="flex items-start gap-3 px-5 py-3">
                    <LevelTag level={i.level} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <KeyLink k={i.key} />
                        {late ? <ToneBadge tone="critical">Past due</ToneBadge> : atRisk.has(i.key) ? <ToneBadge tone="warning">At risk</ToneBadge> : null}
                      </div>
                      <div className="text-sm font-medium text-fg">{i.summary}</div>
                      <div className="mt-0.5 text-xs text-muted">
                        Due {fmtDate(i.dueDate, false)} ({relDays(i.dueDate, m.today)}) · {i.assignee ?? "no owner"}
                      </div>
                      <LastUpdate u={s0.latestUpdate.get(i.key)} today={m.today} />
                      <UpdateComposer issueKey={i.key} scope={scopeKey} back={back} />
                    </div>
                    {node && <Progress done={node.rollup.done} total={node.rollup.total} width="w-20" />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Dependencies" icon={Waypoints} subtitle="What we wait on, and who waits on us" flush>
          {s0.deps.length === 0 ? (
            <p className="p-5 text-sm text-muted">No open dependencies.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s0.deps.map((d) => {
                const incoming = d.direction !== "outgoing";
                const other = incoming ? d.predecessor : d.successor;
                const mine = incoming ? d.successor : d.predecessor;
                return (
                  <li key={`${d.predecessor.key}-${d.successor.key}`} className="flex items-start gap-3 px-5 py-3">
                    <HealthBadge health={d.health} />
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {incoming ? "We wait on" : "Waits on us"} <KeyLink k={other.key} external={!other.inScope} />
                        <span>for</span> <KeyLink k={mine.key} />
                      </div>
                      <Link href={depHref(d)} className="font-medium text-fg hover:text-accent hover:underline">{other.summary}</Link>
                      <div className="mt-0.5 text-xs text-ink-2">{d.reason}</div>
                      <LastUpdate u={s0.latestUpdate.get(other.key)} today={m.today} />
                      <UpdateComposer issueKey={other.key} scope={scopeKey} back={back} label={`Add update on ${other.key}`} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Risks & decisions to review"
        icon={ShieldAlert}
        subtitle={`Raised when there's no update in ${m.cfg.analysis.staleDays} days, it's blocked or stalled, overdue or due soon, or has no owner. Capture what's moving right here.`}
        className="mb-6"
        flush
      >
        {s0.reviewTopics.length === 0 ? (
          <p className="p-5 text-sm text-muted">Every open risk and decision has a recent update and nothing is due. 🎉</p>
        ) : (
          <ul className="divide-y divide-line">
            {s0.reviewTopics.map((t) => (
              <li key={t.issue.key} id={`raid-${t.issue.key}`} className="scroll-mt-20 px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <SeverityIcon severity={t.severity} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ToneBadge tone={t.issue.level === "risk" ? "serious" : "info"} icon={t.issue.level === "decision" ? Scale : ShieldAlert}>
                        {t.issue.level === "risk" ? "Risk" : "Decision"}
                        {t.issue.tier ? ` · T${t.issue.tier}` : ""}
                      </ToneBadge>
                      <KeyLink k={t.issue.key} />
                      <StatusPill issue={t.issue} />
                    </div>
                    <div className="mt-1 text-sm font-medium text-fg">{t.issue.summary}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                      <span>Owner: {t.issue.assignee ?? "none"}</span>
                      {t.issue.dueDate && <span>Target {fmtDate(t.issue.dueDate, false)} ({relDays(t.issue.dueDate, m.today)})</span>}
                      <span>
                        Last activity {t.lastActivity ? `${fmtDate(t.lastActivity.slice(0, 10), false)} (${relDays(t.lastActivity.slice(0, 10), m.today)})` : "never"}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.reasons.map((r) => (
                        <span key={r} className="rounded-md bg-panel-2 px-2 py-0.5 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line">
                          {r}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-sm italic text-ink-2">Ask: {t.question}</p>
                    {t.basis && <p className="text-[11px] text-muted">Based on: {t.basis}</p>}
                    {(t.context.actions.some((a) => a.status === "open") || t.context.mentions.length > 0) && (
                      <ul className="mt-2 grid gap-1 text-xs text-ink-2">
                        {t.context.actions
                          .filter((a) => a.status === "open")
                          .slice(0, 3)
                          .map((a) => (
                            <li key={a.id} className="flex items-center gap-1.5">
                              <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Action item" />
                              <span className="truncate">{a.text}</span>
                              <span className="shrink-0 text-muted">
                                · {a.owner ?? "no owner"}
                                {a.dueDate && ` · due ${fmtDate(a.dueDate, false)}`}
                              </span>
                              {a.dueDate && a.dueDate < m.today && <ToneBadge tone="critical">Overdue</ToneBadge>}
                            </li>
                          ))}
                        {t.context.mentions.slice(0, 1).map((n) => (
                          <li key={`${n.noteId}-${n.line}`} className="flex items-center gap-1.5">
                            <NotebookPen className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Meeting notes" />
                            <span className="truncate">&ldquo;{n.line}&rdquo;</span>
                            <Link href={`/notes#note-${n.noteId}`} className="shrink-0 text-muted hover:underline">
                              {n.title}, {fmtDate(n.date, false)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                    <LastUpdate u={t.lastUpdate} today={m.today} />
                    <UpdateComposer issueKey={t.issue.key} scope={scopeKey} back={`${back}#raid-${t.issue.key}`} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {s0.quietRaid.length > 0 && (
          <details className="border-t border-line">
            <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-accent hover:bg-panel-2">
              {s0.quietRaid.length} other open risk{s0.quietRaid.length === 1 ? "" : "s"} &amp; decision{s0.quietRaid.length === 1 ? "" : "s"} with recent updates
            </summary>
            <ul className="divide-y divide-line border-t border-line">
              {s0.quietRaid.map(({ issue: r, lastUpdate }) => (
                <li key={r.key} id={`raid-${r.key}`} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ToneBadge tone="neutral">{r.level === "risk" ? "Risk" : "Decision"}{r.tier ? ` · T${r.tier}` : ""}</ToneBadge>
                    <KeyLink k={r.key} />
                    <span className="text-sm text-fg">{r.summary}</span>
                  </div>
                  <LastUpdate u={lastUpdate} today={m.today} />
                  <UpdateComposer issueKey={r.key} scope={scopeKey} back={`${back}#raid-${r.key}`} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Program asks for this team" icon={Flag} subtitle="Mark this team's part done here" flush>
          {s0.programAsks.length === 0 ? (
            <p className="p-5 text-sm text-muted">No program asks assigned to {scope.name}.</p>
          ) : (
            <ul className="divide-y divide-line">
              {s0.programAsks.map(({ action: p, assignment: a }) => {
                const due = a.dueDate ?? p.dueDate;
                const late = a.status !== "done" && !!due && due < m.today;
                return (
                  <li key={a.id} className={cx("flex items-start gap-3 px-5 py-3", a.status === "done" && "opacity-60")}>
                    <form action={updateAssignmentAction} className="pt-0.5">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="status" value={a.status === "done" ? "open" : "done"} />
                      <button title={a.status === "done" ? "Reopen" : "Mark done for this team"}>
                        {a.status === "done" ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-muted hover:text-good" />}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <div className={cx("text-sm font-medium text-fg", a.status === "done" && "line-through")}>{p.title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-2">
                        {p.jiraKey && <KeyLink k={p.jiraKey} />}
                        <DateCell date={due} late={late} />
                        <span>{a.owner ?? "no owner"}</span>
                        <span className="text-muted">{p.done}/{p.total} teams done</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Team action items"
          icon={ListChecks}
          flush
          actions={<Link href={`/actions?${scope.kind === "subtrack" ? "subtrack" : "platform"}=${encodeURIComponent(scope.name)}`} className="text-xs font-medium text-accent hover:underline">Manage</Link>}
        >
          {openActions.length === 0 ? (
            <p className="p-5 text-sm text-muted">No open action items.</p>
          ) : (
            <ul className="divide-y divide-line">
              {openActions.map((a) => {
                const late = !!a.dueDate && a.dueDate < m.today;
                return (
                  <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                    <form action={updateActionItemAction} className="pt-0.5">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="back" value={back} />
                      <input type="hidden" name="status" value="done" />
                      <button title="Mark done">
                        <Circle className="h-5 w-5 text-muted hover:text-good" />
                      </button>
                    </form>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-fg">{a.text}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
                        <span>{a.owner ?? "no owner"}</span>
                        {a.dueDate && <DateCell date={a.dueDate} late={late} />}
                        {a.links.length > 0 && (
                          <span className="inline-flex items-center gap-1.5">
                            <Link2 className="h-3.5 w-3.5 text-muted" aria-label="Linked to" />
                            {a.links.map((k) => (
                              <KeyLink key={k} k={k} external={!m.byKey.get(k)?.inScope} />
                            ))}
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function ScopeTabs({ scopes, active }: { scopes: Scope[]; active: Scope }) {
  const group = (kind: Scope["kind"], label: string) => {
    const list = scopes.filter((s) => s.kind === kind);
    if (!list.length) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        {list.map((s) => {
          const on = s.kind === active.kind && s.name === active.name;
          return (
            <Link
              key={scopeId(s)}
              href={s0Href(s)}
              aria-current={on ? "page" : undefined}
              className={cx(
                "rounded-full border px-3 py-1 text-sm transition",
                on ? "border-accent bg-accent text-white shadow-sm" : "border-line bg-panel text-fg hover:border-line-strong",
              )}
            >
              {s.name}
            </Link>
          );
        })}
      </div>
    );
  };
  return (
    <div className="no-print mb-5 flex flex-wrap gap-x-6 gap-y-2">
      {group("subtrack", "Sub-tracks")}
      {group("platform", "Platforms")}
    </div>
  );
}
