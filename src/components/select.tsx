"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as S } from "radix-ui";
import { useState, type ReactNode } from "react";

/** Radix can't use "" as an item value; map it to a sentinel internally. */
const NONE = "__none__";

export type SelectOption = { value: string; label: string };

/**
 * Themed dropdown (Radix Select). The list is rendered by the app, not the OS,
 * so it follows light/dark mode, is keyboard accessible, and looks the same on
 * every platform. Works inside server-action forms via a hidden input.
 */
export function Select({
  name,
  options,
  value,
  defaultValue = "",
  onValueChange,
  label,
  className,
  size = "md",
  "aria-label": ariaLabel,
  highlightWhenSet,
}: {
  name?: string;
  options: SelectOption[];
  /** Controlled value. Omit for uncontrolled (form) use. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  /** Inline prefix shown inside the trigger, e.g. "Sub-track". */
  label?: ReactNode;
  className?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
  /** Tint the trigger when a non-empty value is selected (filters). */
  highlightWhenSet?: boolean;
}) {
  const [inner, setInner] = useState(defaultValue);
  const current = value ?? inner;
  const set = current !== "";
  return (
    <>
      <S.Root
        value={current === "" ? NONE : current}
        onValueChange={(x) => {
          const real = x === NONE ? "" : x;
          if (value === undefined) setInner(real);
          onValueChange?.(real);
        }}
      >
        <S.Trigger
          aria-label={ariaLabel ?? (typeof label === "string" ? label : undefined)}
          className={[
            "inline-flex w-full items-center gap-1.5 rounded-lg border text-left text-fg shadow-sm outline-none transition",
            "focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 data-[state=open]:border-accent",
            size === "sm" ? "h-8 px-2.5 text-sm" : "h-9 px-3 text-sm",
            highlightWhenSet && set ? "border-accent/40 bg-accent-soft" : "border-line bg-panel hover:border-line-strong",
            className ?? "",
          ].join(" ")}
        >
          {label && <span className="shrink-0 text-xs font-medium text-muted">{label}</span>}
          <span className={"min-w-0 flex-1 truncate font-medium " + (set ? "" : "text-ink-2")}>
            <S.Value />
          </span>
          <S.Icon>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
          </S.Icon>
        </S.Trigger>
        <S.Portal>
          <S.Content
            position="popper"
            sideOffset={4}
            className="z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-panel text-fg shadow-pop"
          >
            <S.Viewport className="p-1">
              {options.map((o) => (
                <S.Item
                  key={o.value || NONE}
                  value={o.value === "" ? NONE : o.value}
                  className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-2.5 pr-8 text-sm text-fg outline-none data-[highlighted]:bg-accent-soft data-[highlighted]:text-fg data-[state=checked]:font-medium"
                >
                  <S.ItemText>{o.label}</S.ItemText>
                  <S.ItemIndicator className="absolute right-2 inline-flex">
                    <Check className="h-4 w-4 text-accent" aria-hidden />
                  </S.ItemIndicator>
                </S.Item>
              ))}
            </S.Viewport>
          </S.Content>
        </S.Portal>
      </S.Root>
      {name && <input type="hidden" name={name} value={current} />}
    </>
  );
}
