"use client";

import { Command } from "cmdk";
import {
  ArrowRight,
  ChartGantt,
  CheckCircle2,
  LayoutDashboard,
  ListChecks,
  ListTree,
  NotebookPen,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  TriangleAlert,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// ---------------------------------------------------------------- navigation

type NavItem = { href: string; label: string; icon: LucideIcon; keepFilters?: boolean };

export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Executive overview", icon: LayoutDashboard, keepFilters: true }],
  },
  {
    title: "Plan",
    items: [
      { href: "/hierarchy", label: "Plan hierarchy", icon: ListTree, keepFilters: true },
      { href: "/gantt", label: "Timeline", icon: ChartGantt, keepFilters: true },
      { href: "/dependencies", label: "Dependencies", icon: Waypoints, keepFilters: true },
    ],
  },
  {
    title: "Governance",
    items: [
      { href: "/raid", label: "Risks & decisions", icon: ShieldAlert, keepFilters: true },
      { href: "/actions", label: "Action items", icon: ListChecks },
      { href: "/notes", label: "Meeting notes", icon: NotebookPen },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/sync", label: "Data & Jira sync", icon: RefreshCw },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const carry = new URLSearchParams();
  for (const k of ["subtrack", "platform"]) {
    const v = sp.get(k);
    if (v) carry.set(k, v);
  }
  const qs = carry.toString();
  return (
    <nav className="flex flex-col gap-5" aria-label="Main">
      {NAV_GROUPS.map((g) => (
        <div key={g.title}>
          <div className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-sidebar-ink/60">{g.title}</div>
          <div className="flex flex-col gap-0.5">
            {g.items.map((n) => {
              const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.keepFilters && qs ? `${n.href}?${qs}` : n.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition " +
                    (active
                      ? "bg-white/10 font-medium text-white shadow-[inset_2px_0_0_0_#5598e7]"
                      : "text-sidebar-ink hover:bg-white/5 hover:text-white")
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- filters

export function FilterBar({
  subTracks,
  platforms,
  extra,
}: {
  subTracks: string[];
  platforms: string[];
  extra?: { name: string; label: string; options: { value: string; label: string }[] }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    next.delete("msg");
    next.delete("err");
    router.push(`${pathname}?${next.toString()}`);
  };
  const active = sp.get("subtrack") || sp.get("platform");
  const select = ({ name, label, options }: { name: string; label: string; options: { value: string; label: string }[] }) => {
    const value = sp.get(name) ?? "";
    return (
      <label
        key={name}
        className={
          "inline-flex h-8 items-center gap-1.5 rounded-lg border pl-2.5 pr-1 text-sm shadow-sm transition " +
          (value && (name === "subtrack" || name === "platform")
            ? "border-accent/40 bg-accent-soft"
            : "border-line bg-panel hover:border-line-strong")
        }
      >
        <span className="text-xs font-medium text-muted">{label}</span>
        <select
          className="h-full cursor-pointer bg-transparent pr-1 text-sm font-medium text-fg outline-none"
          value={value}
          onChange={(e) => set(name, e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  };
  return (
    <div className="no-print mb-6 flex flex-wrap items-center gap-2">
      {select({ name: "subtrack", label: "Sub-track", options: [{ value: "", label: "All" }, ...subTracks.map((s) => ({ value: s, label: s }))] })}
      {select({ name: "platform", label: "Platform", options: [{ value: "", label: "All" }, ...platforms.map((s) => ({ value: s, label: s }))] })}
      {extra?.map((x) => select(x))}
      {active && (
        <button
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent hover:bg-accent-soft"
          onClick={() => {
            const next = new URLSearchParams(sp.toString());
            next.delete("subtrack");
            next.delete("platform");
            router.push(`${pathname}?${next.toString()}`);
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- flash

/** Shows ?msg= / ?err= set by server actions after redirect. */
export function Flash() {
  const sp = useSearchParams();
  const msg = sp.get("msg");
  const err = sp.get("err");
  if (!msg && !err) return null;
  const Icon = err ? TriangleAlert : CheckCircle2;
  return (
    <div
      role="status"
      className={
        "mb-5 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm shadow-card " +
        (err ? "border-critical/30 bg-critical-soft text-critical-ink" : "border-good/30 bg-good-soft text-good-ink")
      }
    >
      <Icon className={"mt-px h-4 w-4 shrink-0 " + (err ? "text-critical" : "text-good")} aria-hidden />
      {err ?? msg}
    </div>
  );
}

// ---------------------------------------------------------------- command palette (⌘K)

type SearchItem = { k: string; s: string; l: string; t?: string };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  // Load the search index the first time the palette opens.
  useEffect(() => {
    if (!open || items) return;
    fetch(`${BASE}/api/search`)
      .then((r) => r.json())
      .then((d: SearchItem[]) => setItems(d))
      .catch(() => setItems([]));
  }, [open, items]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const pages = useMemo(() => NAV_GROUPS.flatMap((g) => g.items), []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/40 p-4 pt-[12vh] backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <Command
        label="Search"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-pop"
        onClick={(e) => e.stopPropagation()}
        filter={(value, search, keywords) => {
          const hay = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
          return search
            .toLowerCase()
            .split(/\s+/)
            .every((w) => hay.includes(w))
            ? 1
            : 0;
        }}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="h-4 w-4 text-muted" aria-hidden />
          <Command.Input autoFocus placeholder="Search issues, milestones, risks, pages…" className="h-12 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted" />
          <kbd className="rounded border border-line px-1.5 text-[10px] text-muted">Esc</kbd>
        </div>
        <Command.List className="max-h-[55vh] overflow-y-auto p-2" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted">
            {items === null ? "Loading…" : "No matches."}
          </Command.Empty>
          <Command.Group heading="Go to" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
            {pages.map((p) => (
              <Command.Item key={p.href} value={`page ${p.label}`} onSelect={() => go(p.href)} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg data-[selected=true]:bg-accent-soft">
                <p.icon className="h-4 w-4 text-muted" aria-hidden />
                {p.label}
              </Command.Item>
            ))}
          </Command.Group>
          {items && items.length > 0 && (
            <Command.Group heading="Jira items" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted">
              {items.map((i) => (
                <Command.Item
                  key={i.k}
                  value={`${i.k} ${i.s}`}
                  keywords={[i.l, i.t ?? ""]}
                  onSelect={() => go(`/items/${encodeURIComponent(i.k)}`)}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg data-[selected=true]:bg-accent-soft"
                >
                  <span className="w-16 shrink-0 font-mono text-[10px] font-semibold text-muted">{i.l}</span>
                  <span className="shrink-0 font-mono text-xs text-accent">{i.k}</span>
                  <span className="truncate">{i.s}</span>
                  {i.t && <span className="ml-auto shrink-0 text-xs text-muted">{i.t}</span>}
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted opacity-0 [[data-selected=true]_&]:opacity-100" aria-hidden />
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

export function SearchButton() {
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-muted shadow-sm transition hover:border-line-strong"
    >
      <Search className="h-4 w-4" aria-hidden />
      <span className="flex-1 text-left">Search issues, milestones, risks…</span>
      <kbd className="hidden rounded border border-line bg-panel-2 px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
    </button>
  );
}

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-fg shadow-sm hover:bg-panel-2"
    >
      Print / PDF
    </button>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center rounded-lg border border-line bg-panel px-3 text-sm font-medium shadow-sm md:hidden"
      >
        Menu
      </button>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-950/40 md:hidden" onClick={() => setOpen(false)}>
          <div className="h-full w-64 bg-sidebar p-4" onClick={(e) => e.stopPropagation()}>
            <Nav onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  );
}
