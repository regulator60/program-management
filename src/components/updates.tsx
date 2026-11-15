import { MessageSquarePlus } from "lucide-react";
import { addItemUpdateAction } from "@/app/actions";
import { Button, ToneBadge, cx, fmtDate, inputCls, relDays } from "@/components/ui";
import { PROGRESS_LABEL, type ItemUpdate, type UpdateProgress } from "@/lib/types";

const PROGRESS_TONE: Record<UpdateProgress, "good" | "warning" | "critical" | "info"> = {
  moving: "info",
  stalled: "warning",
  blocked: "critical",
  resolved: "good",
};

export function ProgressBadge({ progress }: { progress: UpdateProgress }) {
  return <ToneBadge tone={PROGRESS_TONE[progress]}>{PROGRESS_LABEL[progress]}</ToneBadge>;
}

/** The latest update on an item: status, note and how long ago. */
export function LastUpdate({ u, today, className }: { u: ItemUpdate | null | undefined; today: string; className?: string }) {
  if (!u) return null;
  return (
    <div className={cx("mt-2 rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm", className)}>
      <div className="mb-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
        {u.progress && <ProgressBadge progress={u.progress} />}
        <span>
          Last update {fmtDate(u.createdAt.slice(0, 10), false)} ({relDays(u.createdAt.slice(0, 10), today)})
        </span>
        {u.sentToJira && <span>· sent to Jira</span>}
      </div>
      <div className="whitespace-pre-wrap text-ink-2">{u.body}</div>
    </div>
  );
}

/**
 * "Add update" disclosure: is it moving, a short note, and optionally stage
 * the note as a Jira comment. Works anywhere an issue key is shown.
 */
export function UpdateComposer({
  issueKey,
  scope,
  back,
  label = "Add update",
  defaultOpen,
}: {
  issueKey: string;
  scope?: string;
  back: string;
  label?: string;
  defaultOpen?: boolean;
}) {
  const options: UpdateProgress[] = ["moving", "stalled", "blocked", "resolved"];
  return (
    <details className="group mt-2" open={defaultOpen}>
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium text-accent hover:bg-accent-soft">
        <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden />
        {label}
      </summary>
      <form action={addItemUpdateAction} className="mt-2 grid gap-2 rounded-lg border border-line bg-panel p-3 shadow-card">
        <input type="hidden" name="key" value={issueKey} />
        <input type="hidden" name="back" value={back} />
        {scope && <input type="hidden" name="scope" value={scope} />}
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="mb-1 text-xs font-medium text-ink-2">Is it moving?</legend>
          {options.map((o) => (
            <label key={o} className="cursor-pointer">
              <input type="radio" name="progress" value={o} className="peer sr-only" />
              <span className="inline-flex rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 transition peer-checked:border-accent peer-checked:bg-accent peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-accent/30 hover:border-line-strong">
                {PROGRESS_LABEL[o]}
              </span>
            </label>
          ))}
        </fieldset>
        <textarea name="body" rows={2} placeholder="What changed? Next step, owner, date…" className={inputCls} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" name="toJira" className="h-4 w-4 accent-[var(--accent)]" />
            Also add as a Jira comment (staged)
          </label>
          <Button size="sm" type="submit">
            Save update
          </Button>
        </div>
      </form>
    </details>
  );
}
