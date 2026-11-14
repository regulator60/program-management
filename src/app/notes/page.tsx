import { connection } from "next/server";
import { Suspense } from "react";
import {
  addNoteAction,
  attachNoteAction,
  deleteNoteAction,
  importConfluenceAction,
  importGoogleDocAction,
  refreshNoteAction,
  stageNoteSuggestionsAction,
} from "@/app/actions";
import { Button, Card, KeyLink, PageHeader, fmtDate, inputCls } from "@/components/ui";
import { getDb, todayIso } from "@/lib/db";
import { ACCEPTED_NOTE_FILES } from "@/lib/documents";
import { loadModel } from "@/lib/model";
import { suggestJiraUpdates, type JiraSuggestion } from "@/lib/noteInsights";
import { withBase } from "@/lib/paths";
import { listActionItems, listNotes } from "@/lib/store";
import type { ActionItem, Note } from "@/lib/types";

export const metadata = { title: "Meeting notes" };

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Notes />
    </Suspense>
  );
}

const FIELD_LABEL: Record<JiraSuggestion["field"], string> = {
  dueDate: "Due date",
  startDate: "Start date",
  status: "Status",
  comment: "Add comment",
};

async function Notes() {
  await connection();
  const db = getDb();
  const m = loadModel(db);
  const notes = listNotes(db);
  const items = listActionItems(db);
  const hasGoogleToken = !!process.env.GOOGLE_ACCESS_TOKEN;
  // Comments already staged or pushed, so they aren't suggested twice.
  const pendingComments = new Set(
    (db.prepare("SELECT key, new_value FROM pending_edits WHERE field = 'comment'").all() as {
      key: string;
      new_value: string;
    }[]).map((r) => `${r.key}|${r.new_value}`),
  );
  const subTrackSelect = (
    <select name="subTrack" defaultValue="" className={inputCls}>
      <option value="">Sub-track (optional)</option>
      {m.subTracks.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Meeting notes"
        subtitle="Import notes from Google Docs or attach a file. Action items are picked out automatically, and Jira updates are suggested for you to review."
      />

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card title="Import from Google Docs">
          <form action={importGoogleDocAction} className="grid gap-2">
            <input name="url" required placeholder="https://docs.google.com/document/d/…/edit" className={inputCls} />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              {subTrackSelect}
              <Button type="submit">Import doc</Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-muted">
            {hasGoogleToken ? (
              <>Using <code>GOOGLE_ACCESS_TOKEN</code>, so private docs you can open will work.</>
            ) : (
              <>
                Works for docs shared &ldquo;anyone with the link&rdquo;. For private docs, set{" "}
                <code>GOOGLE_ACCESS_TOKEN</code> or download the doc and attach it.
              </>
            )}{" "}
            Re-importing the same doc (or clicking Refresh) updates the note and only adds new action items, so running notes docs work.
          </p>
        </Card>

        <Card title="Attach a notes file">
          <form action={attachNoteAction} className="grid gap-2">
            <input type="file" name="file" required accept={ACCEPTED_NOTE_FILES} className={inputCls} />
            <div className="grid gap-2 md:grid-cols-3">
              <input name="title" placeholder="Title (default: file name)" className={inputCls} />
              <input name="meetingDate" type="date" className={inputCls} title="Meeting date (default: from title, else today)" />
              {subTrackSelect}
            </div>
            <Button type="submit">Attach &amp; extract</Button>
          </form>
          <p className="mt-2 text-xs text-muted">
            Google Docs → File → Download as <b>.docx</b>, <b>.txt</b>, <b>.md</b> or <b>.html</b>. The original file is kept
            next to the local database (never in git), and you can download it from the note.
          </p>
        </Card>

        <Card title="Paste notes">
          <form action={addNoteAction} className="grid gap-2">
            <div className="grid gap-2 md:grid-cols-[1fr_160px_180px]">
              <input name="title" placeholder="Meeting / title" className={inputCls} />
              <input name="meetingDate" type="date" defaultValue={todayIso()} className={inputCls} />
              {subTrackSelect}
            </div>
            <textarea
              name="body"
              rows={6}
              required
              className={inputCls + " font-mono text-xs"}
              placeholder={"- BIGP-31 slipped to 12/20\n- AI: Priya to confirm token format by 12/5\n\nNext steps\n- Jordan Kim will draft mitigation options"}
            />
            <Button type="submit">Save &amp; extract</Button>
          </form>
        </Card>

        <Card title="Import from Confluence">
          <form action={importConfluenceAction} className="grid gap-2">
            <input name="page" placeholder="Page URL (…?pageId=123) or page id" className={inputCls} required />
            <Button type="submit">Import page</Button>
          </form>
          <details className="mt-3 text-xs text-muted">
            <summary className="cursor-pointer">What gets picked up?</summary>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>Action items: <code>- [ ]</code> / ☐ checkboxes; <code>AI:</code>, <code>Action:</code>, <code>TODO:</code>, <code>Follow-up:</code>; <code>@name to …</code>; <code>Name will …</code>; and every line under an &ldquo;Action items&rdquo;, &ldquo;Next steps&rdquo; or &ldquo;Suggested next steps&rdquo; heading (Gemini notes).</li>
              <li>Owners from @name, &ldquo;Name to/will&rdquo; or <code>(owner: X)</code>. Due dates from &ldquo;by 12/5&rdquo;, &ldquo;due Nov 30&rdquo;, ISO dates.</li>
              <li>Jira: any line naming a known issue key. Date + &ldquo;moved/slipped/due/target…&rdquo; → date change; &ldquo;done/shipped&rdquo; → Done; &ldquo;started&rdquo; → In Progress; and the line itself as a comment.</li>
            </ul>
          </details>
        </Card>
      </div>

      <div className="grid gap-4">
        {notes.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            items={items.filter((a) => a.noteId === n.id)}
            suggestions={suggestJiraUpdates(n.body, { title: n.title, meetingDate: n.meetingDate }, m.byKey)}
            pendingComments={pendingComments}
          />
        ))}
      </div>
    </>
  );
}

function NoteCard({
  note: n,
  items,
  suggestions,
  pendingComments,
}: {
  note: Note;
  items: ActionItem[];
  suggestions: JiraSuggestion[];
  pendingComments: Set<string>;
}) {
  const open = suggestions.filter((s) => !(s.field === "comment" && pendingComments.has(`${s.key}|${s.value}`)));
  const linked = n.source.startsWith("gdoc:") || n.source.startsWith("confluence:");
  return (
    <Card
      className="scroll-mt-4"
      title={
        <span id={`note-${n.id}`} className="normal-case tracking-normal">
          <span className="text-base font-semibold text-fg">{n.title}</span>{" "}
          <span className="font-normal">
            · {fmtDate(n.meetingDate ?? n.createdAt.slice(0, 10))}
            {n.subTrack && ` · ${n.subTrack}`}
            {n.updatedAt && ` · refreshed ${fmtDate(n.updatedAt.slice(0, 10))}`}
          </span>
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {n.sourceUrl && (
            <a href={n.sourceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              {n.source.startsWith("gdoc:") ? "Open Google Doc ↗" : "Open source ↗"}
            </a>
          )}
          {n.attachmentName && (
            <a href={withBase(`/api/notes/${n.id}/attachment`)} className="text-accent hover:underline">
              ⤓ {n.attachmentName}
            </a>
          )}
          {linked && (
            <form action={refreshNoteAction}>
              <input type="hidden" name="id" value={n.id} />
              <Button variant="secondary" type="submit">Refresh</Button>
            </form>
          )}
          <form action={deleteNoteAction}>
            <input type="hidden" name="id" value={n.id} />
            <Button variant="secondary" type="submit">Delete</Button>
          </form>
        </div>
      }
    >
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <details className="self-start rounded-lg bg-panel-2 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase text-muted">
            Notes ({n.body.split("\n").length} lines)
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs">{n.body}</pre>
        </details>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-muted">Action items ({items.length})</div>
          <ul className="space-y-1 text-sm">
            {items.map((a) => (
              <li key={a.id} className={a.status === "done" ? "line-through opacity-60" : ""}>
                • {a.text}
                <span className="ml-1 text-xs text-muted">
                  {a.owner && `— ${a.owner}`} {a.dueDate && `· ${fmtDate(a.dueDate)}`}
                </span>
              </li>
            ))}
            {items.length === 0 && <li className="text-muted">None found.</li>}
          </ul>
        </div>
      </div>

      {open.length > 0 && (
        <form action={stageNoteSuggestionsAction} className="mt-4 rounded-md border border-line p-3">
          <input type="hidden" name="noteId" value={n.id} />
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold uppercase text-muted">Suggested Jira updates ({open.length})</div>
            <Button type="submit">Stage selected</Button>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {open.map((s, i) => (
                <tr key={`${s.key}-${s.field}-${i}`} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2">
                    <input type="checkbox" name="pick" value={i} defaultChecked aria-label={`Stage ${FIELD_LABEL[s.field]} for ${s.key}`} />
                    <input type="hidden" name={`k-${i}`} value={s.key} />
                    <input type="hidden" name={`f-${i}`} value={s.field} />
                  </td>
                  <td className="py-1.5 pr-2"><KeyLink k={s.key} /></td>
                  <td className="whitespace-nowrap py-1.5 pr-2 text-xs">{FIELD_LABEL[s.field]}</td>
                  <td className="w-full py-1.5 pr-2">
                    {s.field === "comment" ? (
                      <textarea name={`v-${i}`} defaultValue={s.value} rows={2} className={inputCls + " text-xs"} />
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-muted">{s.current ?? "—"} →</span>
                        <input
                          name={`v-${i}`}
                          type={s.field === "status" ? "text" : "date"}
                          defaultValue={s.value}
                          className={inputCls + " w-40"}
                        />
                        <span className="text-muted">{s.reason}</span>
                      </div>
                    )}
                    {s.field !== "comment" && <div className="mt-1 text-xs italic text-muted">&ldquo;{s.evidence}&rdquo;</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            Staged updates show as PENDING and go to Jira only when you push from Data &amp; Jira sync (CSV import or REST).
          </p>
        </form>
      )}
    </Card>
  );
}
