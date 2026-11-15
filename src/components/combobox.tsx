"use client";

import { Command } from "cmdk";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { Popover } from "radix-ui";
import { useMemo, useState } from "react";

export type ComboOption = { value: string; label?: string; hint?: string };

const triggerCls =
  "flex min-h-9 w-full items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-left text-sm text-fg shadow-sm outline-none transition hover:border-line-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 data-[state=open]:border-accent";

function OptionList({
  options,
  selected,
  creatable,
  onPick,
  placeholder,
}: {
  options: ComboOption[];
  selected: Set<string>;
  creatable: boolean;
  onPick: (v: string) => void;
  placeholder: string;
}) {
  const [search, setSearch] = useState("");
  const exact = options.some((o) => o.value.toLowerCase() === search.trim().toLowerCase());
  return (
    <Command
      className="w-[min(420px,90vw)] overflow-hidden rounded-lg border border-line bg-panel text-fg shadow-pop"
      filter={(value, s, keywords) => {
        const hay = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
        return s.toLowerCase().split(/\s+/).every((w) => hay.includes(w)) ? 1 : 0;
      }}
    >
      <Command.Input
        autoFocus
        value={search}
        onValueChange={setSearch}
        placeholder={placeholder}
        className="h-10 w-full border-b border-line bg-transparent px-3 text-sm outline-none placeholder:text-muted"
      />
      <Command.List className="max-h-72 overflow-y-auto p-1">
        <Command.Empty className="px-3 py-3 text-sm text-muted">{creatable ? "No matches. Press Enter to add it." : "No matches."}</Command.Empty>
        {options.map((o) => (
          <Command.Item
            key={o.value}
            value={o.value}
            keywords={[o.label ?? "", o.hint ?? ""]}
            onSelect={() => {
              onPick(o.value);
              setSearch("");
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm data-[selected=true]:bg-accent-soft"
          >
            <Check className={"h-4 w-4 shrink-0 text-accent " + (selected.has(o.value) ? "" : "invisible")} aria-hidden />
            <span className={o.label ? "shrink-0 font-mono text-xs text-accent" : "truncate"}>{o.value}</span>
            {o.label && <span className="truncate">{o.label}</span>}
            {o.hint && <span className="ml-auto shrink-0 text-xs text-muted">{o.hint}</span>}
          </Command.Item>
        ))}
        {creatable && search.trim() && !exact && (
          <Command.Item
            value={`__create__ ${search}`}
            forceMount
            onSelect={() => {
              onPick(search.trim());
              setSearch("");
            }}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm data-[selected=true]:bg-accent-soft"
          >
            <Plus className="h-4 w-4 text-accent" aria-hidden /> Add &ldquo;{search.trim()}&rdquo;
          </Command.Item>
        )}
      </Command.List>
    </Command>
  );
}

/**
 * Pick one value from known options (people, statuses, Jira items…) with
 * type-to-filter; typing something new adds it. Submits via a hidden input.
 */
export function Combobox({
  name,
  options,
  defaultValue = "",
  placeholder = "Select…",
  creatable = true,
  "aria-label": ariaLabel,
}: {
  name: string;
  options: ComboOption[];
  defaultValue?: string;
  placeholder?: string;
  creatable?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const label = options.find((o) => o.value === value)?.label;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger type="button" aria-label={ariaLabel ?? placeholder} className={triggerCls}>
        <span className={"min-w-0 flex-1 truncate " + (value ? "" : "text-muted")}>
          {value ? (
            <>
              {value}
              {label && <span className="ml-1.5 text-muted">{label}</span>}
            </>
          ) : (
            placeholder
          )}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Clear"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setValue("");
            }}
            className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-fg"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50">
          <OptionList
            options={options}
            selected={new Set(value ? [value] : [])}
            creatable={creatable}
            placeholder={`Search or type…`}
            onPick={(v) => {
              setValue(v);
              setOpen(false);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
      <input type="hidden" name={name} value={value} />
    </Popover.Root>
  );
}

/**
 * Pick several values (linked Jira items, labels, issue types) as chips.
 * Submits them comma-separated via a hidden input.
 */
export function MultiCombobox({
  name,
  options,
  defaultValues = [],
  placeholder = "Add…",
  creatable = true,
  "aria-label": ariaLabel,
}: {
  name: string;
  options: ComboOption[];
  defaultValues?: string[];
  placeholder?: string;
  creatable?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<string[]>(defaultValues);
  const selected = useMemo(() => new Set(values), [values]);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const toggle = (v: string) => setValues((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger type="button" aria-label={ariaLabel ?? placeholder} className={triggerCls + " flex-wrap"}>
        {values.length === 0 && <span className="flex-1 text-muted">{placeholder}</span>}
        {values.map((v) => (
          <span
            key={v}
            title={byValue.get(v)?.label}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent"
          >
            <span className="truncate">{v}</span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Remove ${v}`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggle(v);
              }}
              className="rounded hover:bg-accent/15"
            >
              <X className="h-3 w-3" />
            </span>
          </span>
        ))}
        <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 text-muted" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={4} className="z-50">
          <OptionList options={options} selected={selected} creatable={creatable} placeholder="Search or type to add…" onPick={toggle} />
        </Popover.Content>
      </Popover.Portal>
      <input type="hidden" name={name} value={values.join(", ")} />
    </Popover.Root>
  );
}
