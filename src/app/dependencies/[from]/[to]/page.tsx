import { ArrowRight, CalendarClock, CheckCircle2, Circle, Flag, History, Lightbulb, ListChecks, MessageSquareText, NotebookPen, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { addActionItemAction, stageEditsAction, updateActionItemAction } from "@/app/actions";
import { Combobox, MultiCombobox } from "@/components/combobox";
import {
  Button,
  Card,
  DateCell,
  Empty,
  HealthBadge,
  KeyLink,
  LevelTag,
  PageHeader,
  StatusPill,
  TeamSelect,
  ToneBadge,
  cx,
  fmtDate,
  inputCls,
  relDays,
} from "@/components/ui";
import { LastUpdate, UpdateComposer } from "@/components/updates";
import { itemContext, smartQuestion } from "@/lib/context";
import { getDb } from "@/lib/db";
import { needByDate } from "@/lib/dependencies";
import { isLate } from "@/lib/hierarchy";
import { ancestry } from "@/lib/insights";
import { loadModel, type Model } from "@/lib/model";
import { issueOptions, peopleOptions } from "@/lib/options";
import { listActionItems, listAssignments, listItemUpdates, listNotes, type IssueView } from "@/lib/store";

export const metadata = { title: "Dependency" };

export default function Page(props: PageProps<"/dependencies/[from]/[to]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <DependencyView params={props.params} />
    </Suspense>
  );
}

async function DependencyView({ params }: { params: PageProps<"/dependencies/[from]/[to]">["params"] }) {
  await connection();
  const { from, to } = await params;
  const predKey = decodeURIComponent(from);
  const succKey = decodeURIComponent(to);
  const db = getDb();
  const m = loadModel(db);
  const d = m.deps.find((x) => x.predecessor.key === predKey && x.successor.key === succKey);
  if (!d) {
    return (
      <>
        <PageHeader eyebrow="Dependency" title={`${predKey} → ${succKey}`} />
        <Empty>
          There&rsquo;s no dependency link from {predKey} to {succKey} in the local data.{" "}
          <Link href="/dependencies" className="text-accent underline">All dependencies</Link>
        </Empty>
      </>
    );
  }

  const depKey = `dep:${predKey}:${succKey}`;
  const back = `/dependencies/${encodeURIComponent(predKey)}/${encodeURIComponent(succKey)}`;
  const mine = d.direction === "outgoing" ? d.predecessor : d.successor;
  const actions = listActionItems(db);
  const updates = listItemUpdates(db);
  const ctx = itemContext([predKey, succKey], { actions, notes: listNotes(db), updates }, m.today, [depKey]);
  const smart = smartQuestion(ctx, m.today, d.predecessor.assignee);
  const { cpm, outcome } = ancestry(m)(mine.key);
  const history = m.changes
    .filter((c) => (c.key === predKey || c.key === succKey) && ["dueDate", "startDate", "status"].includes(c.field))
    .slice(0, 12);
  const people = peopleOptions(m, actions, listAssignments(db));
  const issues = issueOptions(m);
  const team = { subTrack: m.subTrackOf.get(mine.key) ?? "", platform: (m.platformsOf.get(mine.key) ?? [])[0] ?? "" };
  const open = ctx.actions.filter((a) => a.status === "open");

  return (
    <>
      <PageHeader
        eyebrow="Dependency"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{predKey}</span>
            <ArrowRight className="h-6 w-6 text-muted" aria-label="must finish before" />
            <span className="font-mono">{succKey}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <HealthBadge health={d.health} />
            <span>{d.reason}</span>
            {d.direction !== "internal" && (
              <span className="text-muted">· {d.direction === "incoming" ? "we depend on another track" : "another track depends on us"}</span>
            )}
          </span>
        }
        actions={
          <Link href="/dependencies" className="text-sm font-medium text-accent hover:underline">
            All dependencies
          </Link>
        }
      />

      {smart && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-5 py-4">
          <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden />
          <div>
            <div className="text-sm font-semibold text-fg">Ask next</div>
            <div className="mt-0.5 text-sm text-fg">{smart.question}</div>
            <div className="mt-1 text-xs text-muted">Based on: {smart.basis}</div>
          </div>
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Side role="Must finish first" i={d.predecessor} date={d.predecessor.dueDate} dateLabel="Due" m={m} back={back} />
        <Side role="Needs it" i={d.successor} date={needByDate(d.successor)} dateLabel="Needs it by" m={m} back={back} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid content-start gap-6">
          <Card title="Updates" icon={MessageSquareText} subtitle="Notes on this dependency and on either side, newest first">
            {ctx.updates.length === 0 ? (
              <p className="text-sm text-muted">No updates yet. What&rsquo;s the latest?</p>
            ) : (
              <ul className="grid gap-2">
                {ctx.updates.slice(0, 8).map((u) => (
                  <li key={u.id}>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted">
                      {u.key.startsWith("dep:") ? "This dependency" : u.key}
                    </div>
                    <LastUpdate u={u} today={m.today} className="mt-1" />
                  </li>
                ))}
              </ul>
            )}
            <UpdateComposer issueKey={depKey} commentKey={mine.key} back={back} defaultOpen={ctx.updates.length === 0} />
          </Card>

          <Card title="From meeting notes" icon={NotebookPen} subtitle={`Lines that mention ${predKey} or ${succKey}`} flush>
            {ctx.mentions.length === 0 ? (
              <p className="p-5 text-sm text-muted">Not mentioned in any meeting notes yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {ctx.mentions.slice(0, 8).map((n, idx) => (
                  <li key={`${n.noteId}-${idx}`} className="px-5 py-3 text-sm">
                    <div className="text-fg">&ldquo;{n.line}&rdquo;</div>
                    <Link href={`/notes#note-${n.noteId}`} className="mt-0.5 inline-block text-xs text-muted hover:underline">
                      {n.title} · {fmtDate(n.date, false)}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Date and status history" icon={History} flush>
            {history.length === 0 ? (
              <p className="p-5 text-sm text-muted">No changes detected between syncs.</p>
            ) : (
              <ul className="divide-y divide-line">
                {history.map((c) => {
                  const isDate = c.field.endsWith("Date");
                  const later = isDate && c.oldValue && c.newValue && c.newValue > c.oldValue;
                  return (
                    <li key={c.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="w-20 shrink-0 text-xs text-muted">{fmtDate(c.detectedAt.slice(0, 10), false)}</span>
                      <KeyLink k={c.key} external={!m.byKey.get(c.key)?.inScope} />
                      <span className="text-ink-2">
                        {c.field === "dueDate" ? "Due" : c.field === "startDate" ? "Start" : "Status"}: {isDate ? fmtDate(c.oldValue, false) : c.oldValue} →{" "}
                        <b className={later ? "text-critical-ink" : "text-fg"}>{isDate ? fmtDate(c.newValue, false) : c.newValue}</b>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid content-start gap-6">
          {(cpm || outcome) && (
            <Card title="What this puts at risk" icon={Flag}>
              <ul className="grid gap-2 text-sm">
                {cpm && (
                  <li>
                    <LevelTag level="cpm" /> <KeyLink k={cpm.key} /> <span className="text-fg">{cpm.summary}</span>
                    <div className="text-xs text-muted">Due {fmtDate(cpm.dueDate, false)} ({relDays(cpm.dueDate, m.today)})</div>
                  </li>
                )}
                {outcome && (
                  <li>
                    <LevelTag level="outcome" /> <KeyLink k={outcome.key} /> <span className="text-fg">{outcome.summary}</span>
                  </li>
                )}
              </ul>
            </Card>
          )}

          <Card title={`Action items (${open.length} open)`} icon={ListChecks} flush>
            {ctx.actions.length === 0 ? (
              <p className="px-5 pt-4 text-sm text-muted">No action items yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {ctx.actions.map((a) => {
                  const late = a.status === "open" && !!a.dueDate && a.dueDate < m.today;
                  return (
                    <li key={a.id} className={cx("flex items-start gap-3 px-5 py-3", a.status === "done" && "opacity-60")}>
                      <form action={updateActionItemAction} className="pt-0.5">
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="status" value={a.status === "done" ? "open" : "done"} />
                        <button title={a.status === "done" ? "Reopen" : "Mark done"}>
                          {a.status === "done" ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5 text-muted hover:text-good" />}
                        </button>
                      </form>
                      <div className="min-w-0 flex-1">
                        <div className={cx("text-sm font-medium text-fg", a.status === "done" && "line-through")}>{a.text}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-ink-2">
                          <span>{a.owner ?? "no owner"}</span>
                          {a.dueDate && <DateCell date={a.dueDate} late={late} />}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <form action={addActionItemAction} className="grid gap-2 border-t border-line bg-panel-2 px-5 py-4">
              <input type="hidden" name="back" value={back} />
              <div className="flex items-center gap-1.5 text-sm font-medium text-fg">
                <Plus className="h-4 w-4 text-accent" aria-hidden /> New action item
              </div>
              <input name="text" required placeholder={`e.g. Get a committed date for ${predKey}`} className={inputCls} />
              <div className="grid grid-cols-2 gap-2">
                <Combobox name="owner" options={people} placeholder="Owner" />
                <input name="dueDate" type="date" className={inputCls} aria-label="Due date" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <TeamSelect name="subTrack" options={m.subTracks} placeholder="Sub-track" value={team.subTrack} />
                <TeamSelect name="platform" options={m.platforms} placeholder="Platform" value={team.platform} />
              </div>
              <MultiCombobox name="links" options={issues} defaultValues={[predKey, succKey]} placeholder="Linked items" />
              <div>
                <Button size="sm" type="submit">Add action item</Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}

function Side({ role, i, date, dateLabel, m, back }: { role: string; i: IssueView; date: string | null; dateLabel: string; m: Model; back: string }) {
  const late = isLate(i, m.today);
  return (
    <Card
      title={role}
      icon={CalendarClock}
      actions={!i.inScope ? <ToneBadge tone="neutral">Other track</ToneBadge> : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <LevelTag level={i.level} />
        <KeyLink k={i.key} external={!i.inScope} />
        <StatusPill issue={i} />
      </div>
      <div className="mt-1.5 text-base font-semibold text-fg">{i.summary}</div>
      <dl className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted">{dateLabel}</dt>
        <dd>
          <DateCell date={date} late={late} pending={i.pendingFields.includes("dueDate") || i.pendingFields.includes("startDate")} />{" "}
          <span className="text-xs text-muted">{relDays(date, m.today)}</span>
        </dd>
        <dt className="text-muted">Owner</dt>
        <dd className="text-fg">{i.assignee ?? "—"}</dd>
        <dt className="text-muted">Team</dt>
        <dd className="text-fg">{[m.subTrackOf.get(i.key), ...(m.platformsOf.get(i.key) ?? [])].filter(Boolean).join(" · ") || "—"}</dd>
      </dl>
      <details className="mt-3">
        <summary className="cursor-pointer text-xs font-medium text-accent">Change dates (staged for Jira)</summary>
        <form action={stageEditsAction} className="mt-2 grid gap-2 rounded-lg border border-line p-3">
          <input type="hidden" name="key" value={i.key} />
          <input type="hidden" name="back" value={back} />
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-xs text-muted">
              Start
              <input type="date" name="startDate" defaultValue={i.startDate ?? ""} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Due
              <input type="date" name="dueDate" defaultValue={i.dueDate ?? ""} className={inputCls} />
            </label>
          </div>
          <div>
            <Button size="sm" type="submit">Stage change</Button>
          </div>
          {!i.inScope && <p className="text-xs text-muted">This item belongs to another track. Agree the change with them before pushing it.</p>}
        </form>
      </details>
    </Card>
  );
}
