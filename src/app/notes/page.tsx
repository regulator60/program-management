import { connection } from "next/server";
import { Suspense } from "react";
import { addNoteAction, deleteNoteAction, importConfluenceAction } from "@/app/actions";
import { Button, Card, PageHeader, fmtDate, inputCls } from "@/components/ui";
import { getDb, todayIso } from "@/lib/db";
import { loadModel } from "@/lib/model";
import { listActionItems, listNotes } from "@/lib/store";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Notes />
    </Suspense>
  );
}

async function Notes() {
  await connection();
  const db = getDb();
  const m = loadModel(db);
  const notes = listNotes(db);
  const items = listActionItems(db);

  return (
    <>
      <PageHeader
        title="Notes"
        subtitle="Paste meeting notes or pull a Confluence page; action items are picked out automatically."
      />
      <div className="mb-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
        <Card title="Add notes">
          <form action={addNoteAction} className="grid gap-2">
            <div className="grid gap-2 md:grid-cols-[1fr_160px_180px]">
              <input name="title" placeholder="Meeting / title" className={inputCls} />
              <input name="meetingDate" type="date" defaultValue={todayIso()} className={inputCls} />
              <select name="subTrack" defaultValue="" className={inputCls}>
                <option value="">Sub-track (optional)</option>
                {m.subTracks.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <textarea
              name="body"
              rows={10}
              required
              className={inputCls + " font-mono text-xs"}
              placeholder={"- Discussion point\n- AI: Priya to confirm token format by 12/5\n- [ ] @marcus send SDK notes due 2026-12-01\n- Jordan will draft mitigation options by Nov 30"}
            />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted">
                Recognised: <code>- [ ]</code>, <code>AI:</code>, <code>Action:</code>, <code>TODO:</code>,{" "}
                <code>Follow-up:</code>, <code>@name to …</code>, <code>Name will …</code>. Owner from @name, &ldquo;Name to&rdquo;
                or <code>(owner: X)</code>; due from &ldquo;by/due 12/5&rdquo;, &ldquo;by Nov 30&rdquo;, ISO dates.
              </p>
              <Button type="submit">Save &amp; extract</Button>
            </div>
          </form>
        </Card>
        <Card title="Import from Confluence">
          <form action={importConfluenceAction} className="grid gap-2">
            <input name="page" placeholder="Page URL (…?pageId=123) or page id" className={inputCls} required />
            <Button type="submit">Import page</Button>
            <p className="text-xs text-muted">
              Uses Confluence Server REST with <code>CONFLUENCE_PAT</code>. Confluence task lists become action items.
              Base URL: {m.cfg.confluence.baseUrl || <i>not set (Settings)</i>}
            </p>
          </form>
        </Card>
      </div>

      <div className="grid gap-4">
        {notes.map((n) => {
          const its = items.filter((a) => a.noteId === n.id);
          return (
            <Card
              key={n.id}
              className="scroll-mt-4"
              title={
                <span id={`note-${n.id}`} className="normal-case tracking-normal">
                  <span className="text-base font-semibold text-fg">{n.title}</span>{" "}
                  <span className="font-normal">· {fmtDate(n.meetingDate ?? n.createdAt.slice(0, 10))} · {n.source}</span>
                </span>
              }
              actions={
                <form action={deleteNoteAction}>
                  <input type="hidden" name="id" value={n.id} />
                  <Button variant="secondary" type="submit">Delete</Button>
                </form>
              }
            >
              <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-3 font-mono text-xs dark:bg-zinc-900">{n.body}</pre>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-muted">Action items ({its.length})</div>
                  <ul className="space-y-1 text-sm">
                    {its.map((a) => (
                      <li key={a.id} className={a.status === "done" ? "line-through opacity-60" : ""}>
                        • {a.text}
                        <span className="ml-1 text-xs text-muted">
                          {a.owner && `— ${a.owner}`} {a.dueDate && `· ${fmtDate(a.dueDate)}`}
                        </span>
                      </li>
                    ))}
                    {its.length === 0 && <li className="text-muted">None found.</li>}
                  </ul>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
