import { CheckCircle2, Circle, Flag, Link2, ListChecks, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  addActionItemAction,
  addProgramActionAction,
  closeProgramActionAction,
  deleteActionItemAction,
  setAssignmentsAction,
  updateActionItemAction,
  updateAssignmentAction,
} from "@/app/actions";
import { FilterBar } from "@/components/client";
import { Combobox, MultiCombobox, type ComboOption } from "@/components/combobox";
import { issueOptions, peopleOptions } from "@/lib/options";
import { Button, Card, DateCell, Empty, KeyLink, PageHeader, Progress, TeamSelect, ToneBadge, cx, fmtDate, inputCls } from "@/components/ui";
import { getDb } from "@/lib/db";
import { loadModel, parseFilter, type Model } from "@/lib/model";
import { withBase } from "@/lib/paths";
import { actionInScope, allScopes, listProgramActions, type ProgramAction } from "@/lib/programActions";
import { listActionItems, listAssignments, listNotes } from "@/lib/store";
import { scopeId, type ActionItem, type Scope } from "@/lib/types";

export const metadata = { title: "Action items" };

export default function Page(props: PageProps<"/actions">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Actions searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Actions({ searchParams }: { searchParams: PageProps<"/actions">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const f = parseFilter(sp);
  const showDone = sp.show === "all";
  const db = getDb();
  const m = loadModel(db);
  const actions = listActionItems(db);
  const notes = new Map(listNotes(db).map((n) => [n.id, n]));
  const scopes = allScopes(m);
  const opts: Opts = { people: peopleOptions(m, actions, listAssignments(db)), issues: issueOptions(m) };
  const scope: Scope | null = f.subTrack ? { kind: "subtrack", name: f.subTrack } : f.platform ? { kind: "platform", name: f.platform } : null;
  const qs = new URLSearchParams(
    Object.entries(sp).filter(([k, v]) => typeof v === "string" && !["msg", "err"].includes(k)) as [string, string][],
  ).toString();
  const back = `/actions${qs ? `?${qs}` : ""}`;

  const programs = listProgramActions(db, m, actions).filter(
    (p) =>
      (showDone || !p.closed) &&
      (!scope || p.assignments.some((a) => a.scope.kind === scope.kind && a.scope.name === scope.name)),
  );
  const team = actions
    .filter((a) => a.kind === "team" && (showDone || a.status === "open"))
    .filter((a) => !scope || actionInScope(a, scope, m));
  const unsynced = actions.filter((a) => a.kind === "team" && a.status === "open" && !a.jiraKey).length;

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Action items"
        subtitle="Program action items are asks from the program that each assigned sub-track or platform completes. Team action items are the smaller follow-ups from calls and notes, linked to the milestones, dependencies and risks they move forward."
        actions={
          unsynced > 0 && (
            <a
              href={withBase("/api/export/action-items")}
              className="inline-flex h-9 items-center rounded-lg border border-line bg-panel px-3.5 text-sm font-medium shadow-sm hover:bg-panel-2"
            >
              Export {unsynced} for Jira import (CSV)
            </a>
          )
        }
      />
      <FilterBar
        subTracks={m.subTracks}
        platforms={m.platforms}
        extra={[{ name: "show", label: "Show", options: [{ value: "", label: "Open only" }, { value: "all", label: "Include done" }] }]}
      />

      <Card
        title="Program action items"
        icon={Flag}
        subtitle={`From the Jira intake board (label "${m.cfg.labels.intake}") or added here. Expand one to assign teams or mark a team's part done.`}
        className="mb-6"
        flush
      >
        {programs.length === 0 ? (
          <p className="p-5 text-sm text-muted">No program action items{scope ? ` assigned to ${scope.name}` : ""}.</p>
        ) : (
          <ul className="divide-y divide-line">
            {programs.map((p) => (
              <ProgramRow key={p.parent} p={p} scopes={scopes} today={m.today} back={back} focus={scope} opts={opts} />
            ))}
          </ul>
        )}
        <details className="border-t border-line">
          <summary className="flex cursor-pointer items-center gap-1.5 px-5 py-3 text-sm font-medium text-accent hover:bg-panel-2">
            <Plus className="h-4 w-4" aria-hidden /> New program action item
          </summary>
          <form action={addProgramActionAction} className="grid gap-3 border-t border-line bg-panel-2 px-5 py-4">
            <div className="grid gap-2 md:grid-cols-[1fr_180px_160px]">
              <input name="text" required placeholder="What does the program need every team to do?" className={inputCls} />
              <Combobox name="owner" options={opts.people} placeholder="Requested by" />
              <input name="dueDate" type="date" className={inputCls} />
            </div>
            <ScopeCheckboxes scopes={scopes} checked={new Set(scope ? [scopeId(scope)] : [])} />
            <div>
              <Button type="submit">Create and assign</Button>
            </div>
          </form>
        </details>
      </Card>

      <Card
        title="Team action items"
        icon={ListChecks}
        subtitle="Follow-ups from calls and meeting notes. Jira keys mentioned in the text are linked automatically."
        flush
      >
        <form action={addActionItemAction} className="grid gap-2 border-b border-line bg-panel-2 px-5 py-4">
          <input type="hidden" name="back" value={back} />
          <div className="grid gap-2 md:grid-cols-[1fr_200px_150px]">
            <input name="text" placeholder="New action… e.g. Chase VIEW-50 for a committed date" className={inputCls} required />
            <Combobox name="owner" options={opts.people} placeholder="Owner" />
            <input name="dueDate" type="date" className={inputCls} aria-label="Due date" />
          </div>
          <div className="grid gap-2 md:grid-cols-[160px_160px_1fr_auto]">
            <TeamSelect name="subTrack" options={m.subTracks} placeholder="Sub-track" value={f.subTrack ?? ""} />
            <TeamSelect name="platform" options={m.platforms} placeholder="Platform" value={f.platform ?? ""} />
            <MultiCombobox name="links" options={opts.issues} placeholder="Link to milestones, dependencies, risks…" />
            <Button type="submit">
              <Plus className="h-4 w-4" aria-hidden /> Add
            </Button>
          </div>
        </form>
        {team.length === 0 ? (
          <div className="p-5">
            <Empty>No team action items{scope ? ` for ${scope.name}` : ""}. Add one above, or import meeting notes.</Empty>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {team.map((a) => (
              <TeamRow key={a.id} a={a} m={m} back={back} opts={opts} noteTitle={a.noteId ? notes.get(a.noteId)?.title : undefined} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

function ProgramRow({
  p,
  scopes,
  today,
  back,
  focus,
  opts,
}: {
  opts: Opts;
  p: ProgramAction;
  scopes: Scope[];
  today: string;
  back: string;
  focus: Scope | null;
}) {
  const assigned = new Set(p.assignments.map((a) => scopeId(a.scope)));
  return (
    <li>
      <details open={!!focus}>
        <summary className="grid cursor-pointer gap-3 px-5 py-4 hover:bg-panel-2 md:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {p.jiraKey ? <KeyLink k={p.jiraKey} /> : <span className="font-mono text-xs text-muted">local</span>}
              <span className={cx("font-medium text-fg", p.closed && "text-muted line-through")}>{p.title}</span>
              {p.closed && <ToneBadge tone="good">Closed</ToneBadge>}
              {p.late && <ToneBadge tone="critical">Overdue</ToneBadge>}
              {p.readyToClose && <ToneBadge tone="good">All teams done</ToneBadge>}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.assignments.length === 0 && <span className="text-xs text-warning-ink">Not assigned to any team yet</span>}
              {p.assignments.map((a) => (
                <span
                  key={a.id}
                  className={cx(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                    a.status === "done" ? "border-good/30 bg-good-soft text-good-ink" : "border-line bg-panel text-ink-2",
                  )}
                >
                  {a.status === "done" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-good" aria-label="done" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted" aria-label="open" />
                  )}
                  {a.scope.name}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-start gap-5 text-sm">
            <div className="text-right">
              <div className="text-xs text-muted">Due</div>
              <DateCell date={p.dueDate} late={p.late} />
            </div>
            <div>
              <div className="text-xs text-muted">Teams done</div>
              <Progress done={p.done} total={p.total} width="w-24" />
            </div>
          </div>
        </summary>
        <div className="grid gap-4 border-t border-line bg-panel-2 px-5 py-4 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="mb-2 text-xs font-semibold text-ink-2">Each team&rsquo;s part</div>
            {p.assignments.length === 0 ? (
              <p className="text-sm text-muted">Assign teams on the right.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
                {p.assignments.map((a) => {
                  const due = a.dueDate ?? p.dueDate;
                  const late = a.status !== "done" && !!due && due < today;
                  return (
                    <li key={a.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <form action={updateAssignmentAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="back" value={back} />
                        <input type="hidden" name="status" value={a.status === "done" ? "open" : "done"} />
                        <Button size="sm" variant={a.status === "done" ? "secondary" : "primary"} type="submit">
                          {a.status === "done" ? "Reopen" : "Mark done"}
                        </Button>
                      </form>
                      <span className="w-32 truncate text-sm font-medium text-fg" title={a.scope.name}>
                        {a.scope.name}
                      </span>
                      <span className="text-xs text-muted">{a.scope.kind === "subtrack" ? "sub-track" : "platform"}</span>
                      {a.status === "done" ? (
                        <ToneBadge tone="good">Done {a.doneAt ? fmtDate(a.doneAt, false) : ""}</ToneBadge>
                      ) : late ? (
                        <ToneBadge tone="critical">Overdue</ToneBadge>
                      ) : null}
                      <form action={updateAssignmentAction} className="ml-auto flex items-center gap-1.5">
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="back" value={back} />
                        <div className="w-44">
                          <Combobox name="owner" options={opts.people} defaultValue={a.owner ?? ""} placeholder="Owner" />
                        </div>
                        <input
                          name="dueDate"
                          type="date"
                          defaultValue={a.dueDate ?? ""}
                          title="Team due date (defaults to the ask's due date)"
                          className={inputCls + " h-8 w-36 py-1"}
                        />
                        <Button size="sm" variant="ghost" type="submit">
                          Save
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
            {p.readyToClose && (
              <form action={closeProgramActionAction} className="mt-3">
                <input type="hidden" name="parent" value={p.parent} />
                <input type="hidden" name="back" value={back} />
                <Button type="submit">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {p.parent.startsWith("jira:") ? `Close ${p.jiraKey} in Jira (staged, with summary comment)` : "Close this ask"}
                </Button>
              </form>
            )}
          </div>
          <form action={setAssignmentsAction} className="grid content-start gap-2">
            <input type="hidden" name="parent" value={p.parent} />
            <input type="hidden" name="back" value={back} />
            <div className="text-xs font-semibold text-ink-2">Assigned teams</div>
            <ScopeCheckboxes scopes={scopes} checked={assigned} />
            <div>
              <Button size="sm" variant="secondary" type="submit">
                Update assignments
              </Button>
            </div>
          </form>
        </div>
      </details>
    </li>
  );
}

function ScopeCheckboxes({ scopes, checked }: { scopes: Scope[]; checked: Set<string> }) {
  const group = (kind: Scope["kind"], label: string) => {
    const list = scopes.filter((s) => s.kind === kind);
    if (!list.length) return null;
    return (
      <fieldset className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{label}</legend>
        {list.map((s) => (
          <label key={scopeId(s)} className="inline-flex items-center gap-1.5 text-sm text-fg">
            <input
              type="checkbox"
              name="scope"
              value={scopeId(s)}
              defaultChecked={checked.has(scopeId(s))}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            {s.name}
          </label>
        ))}
      </fieldset>
    );
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {group("subtrack", "Sub-tracks")}
      {group("platform", "Platforms")}
    </div>
  );
}


type Opts = { people: ComboOption[]; issues: ComboOption[] };

function TeamRow({ a, m, back, noteTitle, opts }: { a: ActionItem; m: Model; back: string; noteTitle?: string; opts: Opts }) {
  const late = a.status === "open" && !!a.dueDate && a.dueDate < m.today;
  return (
    <li className={cx("px-5 py-3", a.status === "done" && "opacity-60")}>
      <div className="flex items-start gap-3">
        <form action={updateActionItemAction} className="pt-0.5">
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="back" value={back} />
          <input type="hidden" name="status" value={a.status === "done" ? "open" : "done"} />
          <button title={a.status === "done" ? "Reopen" : "Mark done"} className="text-muted hover:text-good">
            {a.status === "done" ? <CheckCircle2 className="h-5 w-5 text-good" /> : <Circle className="h-5 w-5" />}
          </button>
        </form>
        <div className="min-w-0 flex-1">
          <div className={cx("text-sm font-medium text-fg", a.status === "done" && "line-through")}>{a.text}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
            {a.owner && <span>{a.owner}</span>}
            {a.dueDate && <DateCell date={a.dueDate} late={late} />}
            {(a.subTrack || a.platform) && <span className="text-muted">{[a.subTrack, a.platform].filter(Boolean).join(" · ")}</span>}
            {a.links.length > 0 && (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-muted" aria-label="Linked to" />
                {a.links.map((k) => (
                  <KeyLink key={k} k={k} external={!m.byKey.get(k)?.inScope} />
                ))}
              </span>
            )}
            {a.noteId && noteTitle && (
              <Link href={`/notes#note-${a.noteId}`} className="text-muted hover:underline">
                from “{noteTitle}”
              </Link>
            )}
            {a.jiraKey && (
              <span>
                Jira: <KeyLink k={a.jiraKey} />
              </span>
            )}
          </div>
        </div>
        <details className="relative">
          <summary className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft">Edit</summary>
          <form
            action={updateActionItemAction}
            className="absolute right-0 z-20 mt-1 grid w-80 gap-2 rounded-xl border border-line bg-panel p-4 shadow-pop"
          >
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="back" value={back} />
            <label className="grid gap-1 text-xs text-muted">
              Owner
              <Combobox name="owner" options={opts.people} defaultValue={a.owner ?? ""} placeholder="Owner" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Due
              <input name="dueDate" type="date" defaultValue={a.dueDate ?? ""} className={inputCls} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Sub-track
              <TeamSelect name="subTrack" options={m.subTracks} placeholder="—" value={a.subTrack ?? ""} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Platform
              <TeamSelect name="platform" options={m.platforms} placeholder="—" value={a.platform ?? ""} />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Linked Jira items
              <MultiCombobox name="links" options={opts.issues} defaultValues={a.links} placeholder="Link Jira items…" />
            </label>
            <label className="grid gap-1 text-xs text-muted">
              Tracked in Jira as
              <Combobox name="jiraKey" options={opts.issues} defaultValue={a.jiraKey ?? ""} placeholder="Not in Jira yet" />
            </label>
            <div className="flex justify-between">
              <Button size="sm" type="submit">
                Save
              </Button>
              <Button size="sm" variant="danger" type="submit" formAction={deleteActionItemAction}>
                Delete
              </Button>
            </div>
          </form>
        </details>
      </div>
    </li>
  );
}
