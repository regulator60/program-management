"use client";

import { Plus, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { Combobox, MultiCombobox, type ComboOption } from "./combobox";

const inputCls =
  "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg shadow-sm outline-none transition placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20";

/**
 * "Add action" button + modal for a team's S0 page. Lives in the pinned tab
 * bar, so it's one click away on every tab. Press "a" anywhere on the page to
 * open it. After saving you come back to the tab you were on.
 */
export function AddActionDialog({
  action,
  scope,
  people,
  issues,
}: {
  /** The addActionItemAction server action. */
  action: (fd: FormData) => Promise<void>;
  scope: { kind: "subtrack" | "platform"; name: string };
  people: ComboOption[];
  issues: ComboOption[];
}) {
  const [open, setOpen] = useState(false);
  const [back, setBack] = useState("");

  const show = () => {
    setBack(`${window.location.pathname}${window.location.hash}`);
    setOpen(true);
  };

  // "a" opens the dialog, unless you're typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "a" || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest("[role=dialog],[cmdk-root]"))) return;
      e.preventDefault();
      setBack(`${window.location.pathname}${window.location.hash}`);
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={show}
        title="Add an action item (A)"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-white shadow-sm transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add action
      </button>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] z-40 w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-line bg-panel shadow-pop outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (document.getElementById("add-action-text") as HTMLInputElement | null)?.focus();
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-fg">Add an action item</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted">
                Owned by {scope.name}. Mention a Jira key or an item&rsquo;s name to link it automatically.
              </Dialog.Description>
            </div>
            <Dialog.Close className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg" aria-label="Close">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <form
            action={async (fd) => {
              setOpen(false);
              await action(fd);
            }}
            className="grid gap-3 p-5"
          >
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name={scope.kind === "subtrack" ? "subTrack" : "platform"} value={scope.name} />
            <label className="grid gap-1 text-xs font-medium text-ink-2">
              What needs to happen
              <input
                id="add-action-text"
                name="text"
                required
                autoComplete="off"
                placeholder="e.g. Ask View Account to confirm the Balances API v3 date"
                className={inputCls}
              />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1 text-xs font-medium text-ink-2">
                Owner
                <Combobox name="owner" options={people} placeholder="Pick or type a name" aria-label="Owner" />
              </div>
              <label className="grid gap-1 text-xs font-medium text-ink-2">
                Due date
                <input name="dueDate" type="date" className={inputCls} />
              </label>
            </div>
            <div className="grid gap-1 text-xs font-medium text-ink-2">
              <span>
                Linked work <span className="font-normal text-muted">(optional)</span>
              </span>
              <MultiCombobox name="links" options={issues} placeholder="Milestones, dependencies, risks…" aria-label="Linked work" />
            </div>
            <div className="mt-1 flex items-center justify-end gap-2">
              <Dialog.Close className="h-9 rounded-lg border border-line bg-panel px-3.5 text-sm font-medium text-fg shadow-sm hover:bg-panel-2">
                Cancel
              </Dialog.Close>
              <button type="submit" className="h-9 rounded-lg bg-accent px-3.5 text-sm font-medium text-white shadow-sm hover:brightness-110">
                Add action
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
