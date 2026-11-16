import { CalendarDays, Copy, FileText, Link2, ListChecks, NotebookPen, Sparkles } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  addNoteAction,
  attachNoteAction,
  deleteNoteAction,
  importConfluenceAction,
  importGoogleDocAction,
  refreshNoteAction,
  setNoteLinksAction,
  stageNoteSuggestionsAction,
} from "@/app/actions";
import { MultiCombobox } from "@/components/combobox";
import { Button, Card, KeyLink, PageHeader, TeamSelect, fmtDate, inputCls } from "@/components/ui";
import { getDb, todayIso } from "@/lib/db";
import { ACCEPTED_NOTE_FILES } from "@/lib/documents";
import { loadModel, type Model } from "@/lib/model";
import { suggestJiraUpdates, type JiraSuggestion } from "@/lib/noteInsights";
import { buildItemMatcher, meetingDates } from "@/lib/noteMatch";
import { issueOptions } from "@/lib/options";
import { withBase } from "@/lib/paths";
import { handledNoteSuggestions, listActionItems, listNoteImports, listNotes, type NoteImport } from "@/lib/store";
import type { ActionItem, Note } from "@/lib/types";

export const metadata = { title: "Meeting notes" };

export default function Page(props: PageProps<"/notes">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Notes searchParams={props.searchParams} />
    </Suspense>
  );
}

const FIELD_LABEL: Record<JiraSuggestion["field"], string> = {
  dueDate: "Due date",
  startDate: "Start date",
  status: "Status",
  comment: "Comment",
};

async function Notes({ searchParams }: { searchParams: PageProps<"/notes">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const m = loadModel(db);
  const notes = listNotes(db);
  const items = listActionItems(db);
  const imports = listNoteImports(db);
  const handled = handledNoteSuggestions(db);
  const match = buildItemMatcher(m.issues);
  const options = issueOptions(m);
  const hasGoogleToken = !!process.env.GOOGLE_ACCESS_TOKEN;
  const linkKeys = String(sp.link ?? "")
    .split(/[\s,]+/)
    .map((k) => k.trim().toUpperCase())
    .filter((k) => m.byKey.has(k));
  const linkField = linkKeys.length ? <input type="hidden" name="links" value={linkKeys.join(",")} /> : null;
  const teamSelects = (
    <>
      <TeamSelect name="subTrack" options={m.subTracks} placeholder="Sub-track (optional)" value="" />
      <TeamSelect name="platform" options={m.platforms} placeholder="Platform (optional)" value="" />
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Meeting notes"
        subtitle="Add notes from a Google Doc, a file, Confluence or pasted text. Each note is linked to the work it discusses, with suggested Jira changes and action items for you to review. Nothing goes to Jira until you push it."
      />

      {linkKeys.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-fg">
          <Link2 className="h-4 w-4 text-accent" aria-hidden />
          Notes you add below will be linked to
          {linkKeys.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <KeyLink k={k} /> <span className="text-ink-2">{m.byKey.get(k)?.summary}</span>
            </span>
          ))}
          <Link href="/notes" className="ml-auto text-xs text-muted hover:underline">
            Clear
          </Link>
        </div>
      )}

      <Card title="Add meeting notes" icon={NotebookPen} className="mb-8" subtitle="Pick whichever is easiest. Each one ends up as a note below.">
        <ol className="mb-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Add the notes", "From a Google Doc link, a downloaded file, Confluence, or pasted text."],
            ["Check the linked work", "The milestones, epics, risks and dependencies the notes discuss, found by key or by name."],
            ["Review suggested changes", "New dates and statuses, plus a Jira comment for each item, linking the full notes."],
            ["Stage, then push", "Staged changes go to Jira from Data & Jira sync. Action items are added for you."],
          ].map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-lg bg-panel-2 p-3">
              <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{i + 1}</span>
              <span>
                <span className="block font-medium text-fg">{t}</span>
                <span className="text-xs text-muted">{d}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">Google Doc</h3>
            <form action={importGoogleDocAction} className="grid gap-2">
              {linkField}
              <input name="url" required placeholder="https://docs.google.com/document/d/…/edit" className={inputCls} aria-label="Google Doc link" />
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                {teamSelects}
                <Button type="submit">Import doc</Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-muted">
              {hasGoogleToken ? (
                <>Using <code>GOOGLE_ACCESS_TOKEN</code>, so private docs you can open will work.</>
              ) : (
                <>
                  Works for docs shared &ldquo;anyone with the link&rdquo;. For private docs, set <code>GOOGLE_ACCESS_TOKEN</code> or download the
                  doc and upload it.
                </>
              )}{" "}
              Jira comments link back to the doc. For a running notes doc, import it once and use <b>Refresh</b> after each meeting.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">Upload a file</h3>
            <form action={attachNoteAction} className="grid gap-2">
              {linkField}
              <input type="file" name="file" required accept={ACCEPTED_NOTE_FILES} className={inputCls} aria-label="Notes file" />
              <div className="grid gap-2 sm:grid-cols-2">
                <input name="title" placeholder="Title (default: file name)" className={inputCls} aria-label="Title" />
                <input name="meetingDate" type="date" className={inputCls} aria-label="Meeting date" title="Meeting date (default: from the notes or title)" />
                {teamSelects}
              </div>
              <Button type="submit">Upload &amp; read</Button>
            </form>
            <p className="mt-2 text-xs text-muted">
              .docx, .txt, .md or .html (Google Docs → File → Download). The file is kept next to the local database, never in git.
            </p>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">Paste text</h3>
            <form action={addNoteAction} className="grid gap-2">
              {linkField}
              <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
                <input name="title" placeholder="Meeting name" className={inputCls} aria-label="Meeting name" />
                <input name="meetingDate" type="date" defaultValue={todayIso()} className={inputCls} aria-label="Meeting date" />
              </div>
              <textarea
                name="body"
                rows={5}
                required
                aria-label="Notes"
                className={inputCls + " font-mono text-xs"}
                placeholder={"- Balances API v3 slipped to Jan 30\n- AI: Priya to confirm token format by 12/5\n\nNext steps\n- Jordan Kim will draft re-plan options"}
              />
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                {teamSelects}
                <Button type="submit">Save &amp; read</Button>
              </div>
            </form>
          </section>

          <section>
            <h3 className="mb-2 text-sm font-semibold text-fg">Confluence page</h3>
            <form action={importConfluenceAction} className="grid gap-2">
              <input name="page" placeholder="Page URL (…?pageId=123) or page id" className={inputCls} required aria-label="Confluence page" />
              <Button type="submit" variant="secondary">
                Import page
              </Button>
            </form>
            <div className="mt-4 rounded-lg border border-line p-3 text-xs text-muted">
              <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
                <Copy className="h-3.5 w-3.5" aria-hidden /> No duplicates
              </div>
              Uploading the same notes again, by you or someone else, is recognised and nothing is added twice. A newer download of a running notes doc
              updates the existing note and only adds what&rsquo;s new. Action items already tracked aren&rsquo;t added again, and Jira changes you staged or
              dismissed aren&rsquo;t suggested again.
            </div>
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer">What gets picked up?</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>
                  <b>Linked work:</b> Jira keys, and item names such as &ldquo;Balances API v3&rdquo; or &ldquo;Token service&rdquo;. Names that could mean
                  more than one item are skipped.
                </li>
                <li>
                  <b>Jira changes:</b> a date with &ldquo;moved / slipped / due / target / now&rdquo; suggests a new due date (&ldquo;start&rdquo; → start
                  date); &ldquo;done / shipped&rdquo; → Done; &ldquo;started / in progress&rdquo; → In Progress. In running notes, the latest meeting wins.
                </li>
                <li>
                  <b>Action items:</b> <code>- [ ]</code> / ☐ checkboxes; <code>AI:</code>, <code>Action:</code>, <code>TODO:</code>, <code>Follow-up:</code>;{" "}
                  <code>@name to …</code>; <code>Name will …</code>; lines under &ldquo;Action items&rdquo; or &ldquo;Next steps&rdquo;. Owners and due dates
                  come along.
                </li>
              </ul>
            </details>
          </section>
        </div>
      </Card>

      <h2 className="mb-3 text-sm font-semibold text-fg">
        Notes <span className="font-normal text-muted">({notes.length})</span>
      </h2>
      {notes.length === 0 && <p className="text-sm text-muted">No meeting notes yet.</p>}
      <div className="grid gap-5">
        {notes.map((n) => {
          const excluded = new Set((n.refs ?? []).filter((r) => r.kind === "excluded").map((r) => r.key));
          return (
            <NoteCard
              key={n.id}
              note={n}
              m={m}
              options={options}
              items={items.filter((a) => a.noteId === n.id)}
              imports={imports.get(n.id) ?? []}
              suggestions={suggestJiraUpdates(n.body, { title: n.title, meetingDate: n.meetingDate, sourceUrl: n.sourceUrl }, m.byKey, {
                match,
                exclude: excluded,
                handled,
              })}
            />
          );
        })}
      </div>
    </>
  );
}

const RESULT_LABEL: Record<string, string> = {
  created: "added",
  updated: "updated with a newer version",
  duplicate: "duplicate upload, nothing added",
  unchanged: "no changes",
};

function NoteCard({
  note: n,
  m,
  options,
  items,
  imports,
  suggestions,
}: {
  note: Note;
  m: Model;
  options: ReturnType<typeof issueOptions>;
  items: ActionItem[];
  imports: NoteImport[];
  suggestions: JiraSuggestion[];
}) {
  const linked = n.source.startsWith("gdoc:") || n.source.startsWith("confluence:");
  const refs = (n.refs ?? []).filter((r) => r.kind !== "excluded" && m.byKey.has(r.key));
  const work = [...new Set(refs.map((r) => r.key))].map((k) => ({
    key: k,
    lines: refs.filter((r) => r.key === k && r.line).length,
    manual: refs.some((r) => r.key === k && r.kind === "manual"),
  }));
  work.sort((a, b) => b.lines - a.lines || a.key.localeCompare(b.key));
  const year = n.meetingDate ? Number(n.meetingDate.slice(0, 4)) : new Date().getFullYear();
  const meetings = meetingDates(n.body, year);
  const fieldSuggestions = suggestions.filter((s) => s.field !== "comment");
  const commentSuggestions = suggestions.filter((s) => s.field === "comment");
  const dupes = imports.filter((i) => i.result === "duplicate").length;

  let idx = 0;
  const row = (s: JiraSuggestion) => {
    const i = idx++;
    return (
      <tr key={`${s.key}-${s.field}`} className="border-t border-line align-top">
        <td className="py-2.5 pl-1 pr-2">
          <input type="checkbox" name="pick" value={i} defaultChecked aria-label={`${FIELD_LABEL[s.field]} for ${s.key}`} className="mt-1" />
          <input type="hidden" name={`k-${i}`} value={s.key} />
          <input type="hidden" name={`f-${i}`} value={s.field} />
          <input type="hidden" name={`s-${i}`} value={JSON.stringify(s.sigs)} />
        </td>
        <td className="w-56 py-2.5 pr-3">
          <KeyLink k={s.key} />
          <div className="mt-0.5 line-clamp-2 text-xs text-ink-2">{m.byKey.get(s.key)?.summary}</div>
        </td>
        <td className="py-2.5 pr-2">
          <div className="mb-1 text-xs font-medium text-fg">
            {FIELD_LABEL[s.field]}
            {s.meetingDate && <span className="font-normal text-muted"> · from {fmtDate(s.meetingDate, false)}</span>}
          </div>
          {s.field === "comment" ? (
            <textarea name={`v-${i}`} defaultValue={s.value} rows={Math.min(12, s.value.split("\n").reduce((n, l) => n + Math.ceil((l.length || 1) / 64), 0) + 1)} className={inputCls + " text-xs"} aria-label={`Comment for ${s.key}`} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">{s.field === "status" ? (s.current ?? "—") : fmtDate(s.current)} →</span>
                <input
                  name={`v-${i}`}
                  type={s.field === "status" ? "text" : "date"}
                  defaultValue={s.value}
                  className={inputCls + " h-8 w-40 py-1"}
                  aria-label={`New ${FIELD_LABEL[s.field]} for ${s.key}`}
                />
                <span className="text-muted">{s.reason}</span>
              </div>
              <div className="mt-1 text-xs italic text-muted">&ldquo;{s.evidence}&rdquo;</div>
            </>
          )}
        </td>
      </tr>
    );
  };

  return (
    <section id={`note-${n.id}`} className="scroll-mt-4 rounded-xl border border-line bg-panel shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-fg">{n.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {meetings.length > 1 ? `Running notes · ${meetings.length} meetings · latest ${fmtDate(meetings[0])}` : fmtDate(n.meetingDate ?? n.createdAt.slice(0, 10))}
            </span>
            <span className="inline-flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" aria-hidden />
              {n.source.startsWith("gdoc:") ? "Google Doc" : n.source.startsWith("confluence:") ? "Confluence" : n.attachmentName ? "Uploaded file" : "Pasted"}
            </span>
            {(n.subTrack || n.platform) && <span>{[n.subTrack, n.platform].filter(Boolean).join(" · ")}</span>}
            {imports[0] && (
              <span title={imports.map((i) => `${fmtDate(i.at.slice(0, 10))}: ${i.via}, ${RESULT_LABEL[i.result] ?? i.result}`).join("\n")}>
                Imported {imports.length}× · last {fmtDate(imports[0].at.slice(0, 10), false)} ({RESULT_LABEL[imports[0].result] ?? imports[0].result})
                {dupes > 0 && ` · ${dupes} duplicate upload${dupes === 1 ? "" : "s"} ignored`}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {n.sourceUrl && (
            <a href={n.sourceUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              {n.source.startsWith("gdoc:") ? "Open Google Doc ↗" : "Open source ↗"}
            </a>
          )}
          {n.attachmentName && (
            <a href={withBase(`/api/notes/${n.id}/attachment`)} className="font-medium text-accent hover:underline">
              ⤓ {n.attachmentName}
            </a>
          )}
          {linked && (
            <form action={refreshNoteAction}>
              <input type="hidden" name="id" value={n.id} />
              <Button variant="secondary" size="sm" type="submit">
                Refresh
              </Button>
            </form>
          )}
          <form action={deleteNoteAction}>
            <input type="hidden" name="id" value={n.id} />
            <Button variant="ghost" size="sm" type="submit">
              Delete
            </Button>
          </form>
        </div>
      </header>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-line p-5 lg:border-r">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Sparkles className="h-4 w-4 text-muted" aria-hidden /> Suggested Jira changes
            <span className="tabular rounded-full bg-panel-2 px-2 text-xs font-medium text-ink-2">{suggestions.length}</span>
          </h4>
          {suggestions.length === 0 ? (
            <p className="text-sm text-muted">Nothing to change. Everything here matches Jira or was already staged or dismissed.</p>
          ) : (
            <form action={stageNoteSuggestionsAction}>
              <input type="hidden" name="noteId" value={n.id} />
              <p className="mb-2 text-xs text-muted">
                Untick or edit anything before staging.
                {n.sourceUrl ? " Comments include a link to the full notes." : " Import from Google Docs to include a link to the full notes in comments."}
              </p>
              <table className="w-full text-sm">
                <tbody>
                  {fieldSuggestions.map(row)}
                  {commentSuggestions.map(row)}
                </tbody>
              </table>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="submit" name="intent" value="stage">
                  Stage selected
                </Button>
                <Button type="submit" name="intent" value="dismiss" variant="secondary">
                  Dismiss selected
                </Button>
                <span className="text-xs text-muted">Staged changes go to Jira when you push from Data &amp; Jira sync.</span>
              </div>
            </form>
          )}
        </div>

        <div className="min-w-0 border-t border-line p-5 lg:border-t-0">
          <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <Link2 className="h-4 w-4 text-muted" aria-hidden /> Linked work
          </h4>
          <p className="mb-2 text-xs text-muted">What these notes discuss. Item pages show the matching lines.</p>
          {work.length === 0 ? (
            <p className="mb-2 text-sm text-muted">No items recognised. Add them below.</p>
          ) : (
            <ul className="mb-3 grid gap-1">
              {work.map((w) => (
                <li key={w.key} className="flex min-w-0 items-baseline gap-2 text-sm">
                  <KeyLink k={w.key} />
                  <span className="truncate text-ink-2">{m.byKey.get(w.key)?.summary}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted">
                    {w.lines > 0 ? `${w.lines} line${w.lines === 1 ? "" : "s"}` : w.manual ? "added by you" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-medium text-accent">Edit linked work</summary>
            <form action={setNoteLinksAction} className="mt-2 grid gap-2">
              <input type="hidden" name="noteId" value={n.id} />
              <MultiCombobox name="keys" options={options} defaultValues={work.map((w) => w.key)} placeholder="Add milestones, epics, risks…" aria-label="Linked work" />
              <Button type="submit" size="sm" variant="secondary">
                Save links
              </Button>
              <p className="text-xs text-muted">Removing an item also stops it from being suggested again after a refresh.</p>
            </form>
          </details>

          <h4 className="mb-1 mt-5 flex items-center gap-1.5 text-sm font-semibold text-fg">
            <ListChecks className="h-4 w-4 text-muted" aria-hidden /> Action items
            <span className="tabular rounded-full bg-panel-2 px-2 text-xs font-medium text-ink-2">{items.length}</span>
          </h4>
          {items.length === 0 ? (
            <p className="text-sm text-muted">None found, or already tracked from other notes.</p>
          ) : (
            <ul className="grid gap-1.5 text-sm">
              {items.map((a) => (
                <li key={a.id} className={a.status === "done" ? "text-muted line-through" : "text-fg"}>
                  {a.text}
                  <span className="ml-1 text-xs text-muted">
                    {a.owner && `· ${a.owner}`} {a.dueDate && `· due ${fmtDate(a.dueDate, false)}`}
                  </span>
                  {a.links.length > 0 && (
                    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                      {a.links.map((k) => (
                        <KeyLink key={k} k={k} />
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Link href="/actions" className="mt-2 inline-block text-xs text-accent hover:underline">
            Manage action items →
          </Link>
        </div>
      </div>

      <details className="border-t border-line px-5 py-3">
        <summary className="cursor-pointer text-xs font-semibold text-muted">Full notes ({n.body.split("\n").length} lines)</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-panel-2 p-3 font-mono text-xs text-ink-2">{n.body}</pre>
      </details>
    </section>
  );
}
