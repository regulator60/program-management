"use client";

import { ArrowUp, Check, Loader2, MessageSquarePlus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ProposedChange } from "@/lib/assistant/tools";

type Turn = { id: number; role: "user" | "assistant"; text: string; proposals: ProposedChange[]; applied: number[]; at: string };
type Status = { available: boolean; mode: "off" | "demo" | "on"; reason: string | null; model: string; endpoint: string };

const SUGGESTIONS = [
  "What needs attention this week, and why?",
  "Which dependencies put a critical path milestone at risk?",
  "What did we last agree in meeting notes about the Balances API?",
];

/**
 * The assistant panel: ask about the plan, or tell it news and review the
 * changes it proposes. Opens from the button at the bottom right or ⌘J / Ctrl+J.
 */
export function Assistant() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [chatId, setChatId] = useState<number | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  const load = useCallback(
    async (id?: number | null) => {
      const r = await fetch(`${base}/api/assistant${id ? `?chat=${id}` : ""}`, { cache: "no-store" });
      const d = await r.json();
      setStatus(d.status);
      setChatId(d.chatId ?? null);
      setTurns(d.turns ?? []);
    },
    [base],
  );

  const seq = useRef(0);
  const openRef = useRef(false);
  const show = useCallback(
    (on: boolean) => {
      openRef.current = on;
      setOpen(on);
      if (!on) return;
      load().catch(() => setError("Couldn't load the assistant."));
      setTimeout(() => input.current?.focus(), 50);
    },
    [load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        show(!openRef.current);
      } else if (e.key === "Escape" && openRef.current) {
        show(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const send = async (msg: string) => {
    const t = msg.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    const pending: Turn = { id: -++seq.current, role: "user", text: t, proposals: [], applied: [], at: "" };
    setTurns((cur) => [...cur, pending]);
    try {
      const page = `the "${document.title.replace(/ · Track PM$/, "")}" page (${window.location.pathname}${window.location.hash})`;
      const r = await fetch(`${base}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId, text: t, page }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Something went wrong.");
      setChatId(d.chatId);
      setTurns((cur) => [...cur.filter((x) => x.id !== pending.id), ...d.turns]);
    } catch (e) {
      setTurns((cur) => cur.filter((x) => x.id !== pending.id));
      setText(t);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = async (turn: Turn, picks: number[], intent: "stage" | "dismiss") => {
    const r = await fetch(`${base}/api/assistant/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: turn.id, picks, intent }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Couldn't apply.");
    setTurns((cur) => cur.map((x) => (x.id === turn.id ? { ...x, applied: d.applied } : x)));
    router.refresh();
    return d as { staged: number; actions: number; updates: number; done: number; dismissed: number };
  };

  const newChat = () => {
    setChatId(null);
    setTurns([]);
    setError(null);
    input.current?.focus();
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => show(true)}
          title="Ask the assistant (⌘J)"
          className="no-print fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-pop transition hover:brightness-110"
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Ask
        </button>
      )}

      {open && (
        <aside
          aria-label="Assistant"
          className="no-print fixed inset-y-0 right-0 z-40 flex w-full max-w-[440px] flex-col border-l border-line bg-panel shadow-pop"
        >
          <header className="flex items-start gap-2 border-b border-line px-4 py-3">
            <Sparkles className="mt-0.5 h-4 w-4 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-fg">Assistant</h2>
                <span className="rounded-full bg-warning-soft px-1.5 text-[10px] font-semibold uppercase tracking-wide text-warning-ink">Preview</span>
              </div>
              <p className="truncate text-[11px] text-muted" title={status ? `${status.model} via ${status.endpoint}` : undefined}>
                {status
                  ? `${status.mode === "demo" ? "Demo data only" : status.mode === "on" ? "On" : "Off"} · ${status.model} · ${status.endpoint}`
                  : "Loading…"}
              </p>
            </div>
            <button type="button" onClick={newChat} title="New conversation" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg">
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => show(false)} title="Close (Esc)" className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg">
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {status && !status.available && (
              <div className="rounded-lg border border-line bg-panel-2 p-3 text-sm text-ink-2">
                <p className="font-medium text-fg">The assistant isn&rsquo;t available</p>
                <p className="mt-1">{status.reason}</p>
                <p className="mt-2 text-xs text-muted">See &ldquo;Assistant&rdquo; in the README for setup.</p>
              </div>
            )}
            {status?.available && turns.length === 0 && (
              <div className="text-sm text-ink-2">
                <p>Ask about milestones, dependencies, risks, actions or meeting notes. Or tell me news, like a new date or something that&rsquo;s done, and I&rsquo;ll propose the updates for you to review.</p>
                <div className="mt-3 grid gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-lg border border-line px-3 py-2 text-left text-[13px] text-fg transition hover:border-accent hover:bg-accent-soft"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted">
                  Answers come from this app&rsquo;s data. Nothing changes until you stage a proposal, and Jira only changes when you push.
                </p>
              </div>
            )}
            {turns.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="flex justify-end">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white">{t.text}</div>
                </div>
              ) : (
                <div key={t.id} className="text-sm leading-relaxed text-fg">
                  <Markdown text={t.text} />
                  {t.proposals.length > 0 && <Proposals turn={t} onApply={apply} />}
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Looking into it…
              </div>
            )}
            {error && <div className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical-ink">{error}</div>}
          </div>

          <form
            className="border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-line bg-panel px-3 py-2 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
              <textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(text);
                  }
                }}
                rows={Math.min(6, Math.max(1, text.split("\n").length))}
                disabled={!status?.available || busy}
                placeholder={status?.available ? "Ask a question or share an update…" : "Assistant is off"}
                aria-label="Message"
                className="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm text-fg outline-none placeholder:text-muted disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!status?.available || busy || !text.trim()}
                aria-label="Send"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-muted">Enter to send · Shift+Enter for a new line · ⌘J to close</p>
          </form>
        </aside>
      )}
    </>
  );
}

// ------------------------------------------------------------------ proposals

const fmt = (iso: string | null) =>
  iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : (iso ?? "none");

function describe(p: ProposedChange): { where: "Jira" | "App"; title: ReactNode; detail?: string } {
  switch (p.kind) {
    case "field":
      return {
        where: "Jira",
        title: (
          <>
            <KeyChip k={p.key} /> {p.field === "dueDate" ? "Due date" : p.field === "startDate" ? "Start date" : "Status"}:{" "}
            {p.field === "status" ? (p.current ?? "none") : fmt(p.current)} → <b>{p.field === "status" ? p.value : fmt(p.value)}</b>
          </>
        ),
      };
    case "comment":
      return { where: "Jira", title: <><KeyChip k={p.key} /> Comment</>, detail: p.body };
    case "update":
      return {
        where: "App",
        title: (
          <>
            <KeyChip k={p.key} /> Status update{p.progress ? ` · ${p.progress[0].toUpperCase()}${p.progress.slice(1)}` : ""}
          </>
        ),
        detail: p.body || undefined,
      };
    case "action":
      return {
        where: "App",
        title: <>New action: {p.text}</>,
        detail: [p.owner, p.dueDate && `due ${fmt(p.dueDate)}`, p.team, p.links.join(" ")].filter(Boolean).join(" · ") || undefined,
      };
    case "actionDone":
      return { where: "App", title: <>Mark action done: {p.text}</> };
  }
}

function Proposals({ turn, onApply }: { turn: Turn; onApply: (t: Turn, picks: number[], intent: "stage" | "dismiss") => Promise<{ staged: number; actions: number; updates: number; done: number; dismissed: number }> }) {
  const open = turn.proposals.map((_, i) => i).filter((i) => !turn.applied.includes(i));
  const [picked, setPicked] = useState<Set<number>>(() => new Set(open));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async (intent: "stage" | "dismiss") => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await onApply(turn, [...picked].filter((i) => open.includes(i)), intent);
      const parts = [
        r.staged && `${r.staged} Jira change${r.staged === 1 ? "" : "s"} staged (push from Data & Jira sync)`,
        r.actions && `${r.actions} action${r.actions === 1 ? "" : "s"} added`,
        r.updates && `${r.updates} update${r.updates === 1 ? "" : "s"} saved`,
        r.done && `${r.done} action${r.done === 1 ? "" : "s"} marked done`,
        r.dismissed && `${r.dismissed} dismissed`,
      ].filter(Boolean);
      setMsg(parts.join(" · ") || "Nothing selected.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-line bg-panel-2/60">
      <div className="border-b border-line px-3 py-2 text-xs font-semibold text-fg">Proposed changes</div>
      <ul className="divide-y divide-line">
        {turn.proposals.map((p, i) => {
          const d = describe(p);
          const done = turn.applied.includes(i);
          return (
            <li key={i} className={"flex gap-2.5 px-3 py-2.5 " + (done ? "opacity-55" : "")}>
              {done ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-label="Handled" />
              ) : (
                <input
                  type="checkbox"
                  checked={picked.has(i)}
                  onChange={(e) =>
                    setPicked((cur) => {
                      const n = new Set(cur);
                      if (e.target.checked) n.add(i);
                      else n.delete(i);
                      return n;
                    })
                  }
                  className="mt-1"
                  aria-label={`Include change ${i + 1}`}
                />
              )}
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 text-fg">{d.title}</div>
                  <span className="shrink-0 rounded bg-panel px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted ring-1 ring-line">
                    {d.where}
                  </span>
                </div>
                {d.detail && <p className="mt-0.5 line-clamp-4 whitespace-pre-wrap text-ink-2">{d.detail}</p>}
                <p className="mt-0.5 text-[11px] italic text-muted">{p.reason}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {open.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
          <button
            type="button"
            disabled={busy || !open.some((i) => picked.has(i))}
            onClick={() => go("stage")}
            className="h-7 rounded-lg bg-accent px-2.5 text-xs font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            Stage selected
          </button>
          <button
            type="button"
            disabled={busy || !open.some((i) => picked.has(i))}
            onClick={() => go("dismiss")}
            className="h-7 rounded-lg border border-line bg-panel px-2.5 text-xs font-medium text-fg hover:bg-panel-2 disabled:opacity-40"
          >
            Dismiss
          </button>
        </div>
      )}
      {msg && <p className="border-t border-line px-3 py-2 text-xs text-ink-2">{msg}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ text rendering

function KeyChip({ k }: { k: string }) {
  return (
    <Link href={`/items/${encodeURIComponent(k)}`} className="font-mono text-[12px] font-semibold text-accent hover:underline">
      {k}
    </Link>
  );
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:\/|https?:\/\/)[^)\s]+\)|\b[A-Z][A-Z0-9]{1,9}-\d+\b)/g;

function inline(s: string): ReactNode[] {
  return s.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (part.startsWith("**") && part.endsWith("**")) return <b key={i}>{inline(part.slice(2, -2))}</b>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-panel-2 px-1 text-[12px]">{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return link[2].startsWith("/") ? (
        <Link key={i} href={link[2]} className="text-accent hover:underline">{link[1]}</Link>
      ) : (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="text-accent hover:underline">{link[1]}</a>
      );
    }
    if (/^[A-Z][A-Z0-9]{1,9}-\d+$/.test(part)) return <KeyChip key={i} k={part} />;
    return part;
  });
}

/** A small, safe subset of Markdown: paragraphs, bullet and numbered lists, bold, code, links, Jira keys. */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={(list.ordered ? "list-decimal" : "list-disc") + " space-y-1 pl-5"}>
        {list.items.map((it, i) => (
          <li key={i}>{inline(it)}</li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || num) {
      const ordered = !!num;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      heading ? (
        <p key={blocks.length} className="font-semibold">{inline(heading[1])}</p>
      ) : (
        <p key={blocks.length}>{inline(line)}</p>
      ),
    );
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}
