"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Sub-track / platform filter. Lives in the URL so views are shareable/bookmarkable. */
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
  const sel = "rounded-md border border-line bg-panel px-2 py-1 text-sm";
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-1.5">
        <span className="text-muted">Sub-track</span>
        <select className={sel} value={sp.get("subtrack") ?? ""} onChange={(e) => set("subtrack", e.target.value)}>
          <option value="">All</option>
          {subTracks.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-muted">Platform</span>
        <select className={sel} value={sp.get("platform") ?? ""} onChange={(e) => set("platform", e.target.value)}>
          <option value="">All</option>
          {platforms.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      {extra?.map((x) => (
        <label key={x.name} className="flex items-center gap-1.5">
          <span className="text-muted">{x.label}</span>
          <select className={sel} value={sp.get(x.name) ?? ""} onChange={(e) => set(x.name, e.target.value)}>
            {x.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      {(sp.get("subtrack") || sp.get("platform")) && (
        <button className="text-accent hover:underline" onClick={() => router.push(pathname)}>
          Clear
        </button>
      )}
    </div>
  );
}

/** Shows ?msg= / ?err= set by server actions after redirect. */
export function Flash() {
  const sp = useSearchParams();
  const msg = sp.get("msg");
  const err = sp.get("err");
  if (!msg && !err) return null;
  return (
    <div
      role="status"
      className={
        "mb-4 rounded-md border px-3 py-2 text-sm " +
        (err
          ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
          : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200")
      }
    >
      {err ?? msg}
    </div>
  );
}

const NAV = [
  { href: "/", label: "Executive overview" },
  { href: "/hierarchy", label: "Plan hierarchy" },
  { href: "/gantt", label: "Gantt" },
  { href: "/dependencies", label: "Dependencies" },
  { href: "/raid", label: "Risks & decisions" },
  { href: "/actions", label: "Action items" },
  { href: "/notes", label: "Notes" },
  { href: "/sync", label: "Data & Jira sync" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const sp = useSearchParams();
  // Carry filters between views.
  const carry = new URLSearchParams();
  for (const k of ["subtrack", "platform"]) {
    const v = sp.get(k);
    if (v) carry.set(k, v);
  }
  const qs = carry.toString();
  return (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((n) => {
        const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        const keep = !["/sync", "/settings", "/notes"].includes(n.href) && qs;
        return (
          <Link
            key={n.href}
            href={keep ? `${n.href}?${qs}` : n.href}
            className={
              "rounded-md px-3 py-1.5 text-sm " +
              (active ? "bg-accent/10 font-medium text-accent" : "text-fg hover:bg-zinc-100 dark:hover:bg-zinc-800")
            }
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
