import {
  Braces,
  Building2,
  CheckCircle2,
  Columns3,
  FileText,
  Gauge,
  KeyRound,
  Layers,
  PlugZap,
  Sparkles,
  Tags,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  resetSettingsAction,
  saveAssistantSettingsAction,
  saveSettingsAction,
  saveSettingsSectionAction,
  testAssistantAction,
  testJiraAction,
} from "@/app/actions";
import { assistantConfig, assistantStatus } from "@/lib/assistant/config";
import { Button, Card, PageHeader, cx, inputCls } from "@/components/ui";
import { getConfig, type AppConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { jiraAuthHeader } from "@/lib/jira/client";
import { loadModel } from "@/lib/model";
import { issueTypeOptions, labelOptions, statusOptions } from "@/lib/options";
import { Combobox, MultiCombobox } from "@/components/combobox";

export const metadata = { title: "Settings" };

export default function Page(props: PageProps<"/settings">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Settings searchParams={props.searchParams} />
    </Suspense>
  );
}

type Field = {
  path: string;
  label: string;
  help?: string;
  type: "text" | "num" | "list" | "textarea";
  placeholder?: string;
  mono?: boolean;
  /** Offer known values from your Jira data (you can still type new ones). */
  options?: "issueTypes" | "labels" | "statuses";
};

type Section = {
  id: string;
  title: string;
  icon: LucideIcon;
  description: string;
  fields?: Field[];
};

const SECTIONS: Section[] = [
  {
    id: "general",
    title: "General",
    icon: Building2,
    description: "How the app names your track.",
    fields: [{ path: "trackName", label: "Track name", help: "Shown on the executive overview and in summaries.", type: "text", placeholder: "Digital" }],
  },
  {
    id: "jira",
    title: "Jira connection",
    icon: PlugZap,
    description: "Where your Jira Server lives and which issues belong to your track.",
    fields: [
      { path: "jira.baseUrl", label: "Jira base URL", help: "The root of your Jira Server or Data Center, without /browse.", type: "text", placeholder: "https://jira.yourcompany.com", mono: true },
      { path: "jira.scopeJql", label: "Your track (JQL)", help: "Returns everything in your track: outcomes, milestones, epics, stories, risks and decisions.", type: "textarea", mono: true },
      { path: "jira.intakeJql", label: "Program action items (JQL)", help: "The intake board. Leave empty to skip.", type: "textarea", mono: true },
      { path: "jira.pageSize", label: "Page size", help: "Issues per search request.", type: "num" },
      { path: "jira.writeDelayMs", label: "Pause between REST writes (ms)", help: "Jira Server can be touchy with bursts of writes.", type: "num" },
      { path: "jira.doneStatus", options: "statuses", label: "Done status", help: "Status used when closing a program action item every team finished.", type: "text", placeholder: "Done" },
    ],
  },
  {
    id: "confluence",
    title: "Confluence",
    icon: FileText,
    description: "For importing meeting notes from Confluence pages.",
    fields: [{ path: "confluence.baseUrl", label: "Confluence base URL", type: "text", placeholder: "https://wiki.yourcompany.com", mono: true }],
  },
  {
    id: "types",
    title: "Issue types",
    icon: Layers,
    description: "The exact Jira issue type names for each level of the plan. Pick from the types in your data, or type a new one.",
    fields: [
      { path: "issueTypes.outcome", options: "issueTypes", label: "Outcomes", type: "list" },
      { path: "issueTypes.cpm", options: "issueTypes", label: "Critical path milestones", type: "list" },
      { path: "issueTypes.ipm", options: "issueTypes", label: "Interim milestones", help: "Interim milestones with the Intent label (see Labels & links) become intent milestones.", type: "list" },
      { path: "issueTypes.epic", options: "issueTypes", label: "Epics", type: "list" },
      { path: "issueTypes.risk", options: "issueTypes", label: "Risks", type: "list" },
      { path: "issueTypes.decision", options: "issueTypes", label: "Decisions", type: "list" },
      { path: "issueTypes.action", options: "issueTypes", label: "Action items", help: "Issue type used when exporting new action items for Jira import.", type: "list" },
    ],
  },
  {
    id: "fields",
    title: "Fields",
    icon: Columns3,
    description: "Custom field ids, found at /rest/api/2/field on your Jira, and the column names used in import CSVs.",
    fields: [
      { path: "fields.startDate", label: "Start date field", type: "text", placeholder: "customfield_10015", mono: true },
      { path: "fields.dueDate", label: "Due / target date field", help: "Usually duedate.", type: "text", placeholder: "duedate", mono: true },
      { path: "fields.epicLink", label: "Epic Link field", type: "text", placeholder: "customfield_10014", mono: true },
      { path: "fields.tier", label: "Tier field (optional)", help: "Leave empty to read the tier from labels.", type: "text", mono: true },
      { path: "fields.subTrack", label: "Sub-track field (optional)", help: "Leave empty to read the sub-track from labels.", type: "text", mono: true },
      { path: "csvColumns.startDate", label: "CSV column: start date", help: "Must match the field name in Jira's CSV importer.", type: "text" },
      { path: "csvColumns.dueDate", label: "CSV column: due date", type: "text" },
    ],
  },
  {
    id: "labels",
    title: "Labels & links",
    icon: Tags,
    description: "Your Jira label conventions, and the link type that builds the plan hierarchy.",
    fields: [
      { path: "labels.intent", options: "labels", label: "Intent label", help: "Marks interim milestones that are intent milestones.", type: "text" },
      { path: "labels.intake", options: "labels", label: "Intake label", help: "Marks program action items.", type: "text" },
      { path: "labels.platformPrefix", label: "Platform label prefix", help: 'For example "Domain:" turns Domain:iOS into platform iOS.', type: "text", mono: true },
      { path: "labels.subTrackPrefix", label: "Sub-track label prefix", type: "text", mono: true },
      { path: "labels.tierPattern", label: "Tier label pattern", help: "Regular expression with one capture group for the tier number.", type: "text", mono: true },
      { path: "links.containsOutward", label: "Hierarchy link (outward verb)", help: 'The "contains" verb of your milestone link type.', type: "text" },
    ],
  },
  {
    id: "analysis",
    title: "Analysis",
    icon: Gauge,
    description: "Thresholds for flags, warnings and the S0 review.",
    fields: [
      { path: "analysis.bufferDays", label: "Dependency buffer (days)", help: "Dependencies with less buffer than this are flagged as tight.", type: "num" },
      { path: "analysis.recentChangeDays", label: "Recent change window (days)", help: "How far back date changes count as recent.", type: "num" },
      { path: "analysis.staleDays", label: "Ask for an update after (days)", help: "Risks and decisions with no update for this long are raised in S0 calls.", type: "num" },
    ],
  },
  {
    id: "assistant",
    title: "Assistant",
    icon: Sparkles,
    description: "The in-app chat assistant (preview). Off by default, because questions send program data to an AI endpoint.",
  },
  { id: "credentials", title: "Credentials", icon: KeyRound, description: "Tokens come from environment variables and are never stored in the database." },
  { id: "advanced", title: "Advanced", icon: Braces, description: "Edit the raw configuration, or reset it to the defaults." },
];

function getPath(cfg: AppConfig, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), cfg);
}

async function Settings({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const cfg = getConfig(db);
  const m = loadModel(db);
  const known = { issueTypes: issueTypeOptions(m), labels: labelOptions(m), statuses: statusOptions(m) };
  const active = SECTIONS.find((s) => s.id === sp.section) ?? SECTIONS[0];

  return (
    <>
      <PageHeader eyebrow="Data" title="Settings" subtitle="Map the app onto your Jira, Confluence and team conventions. Saved locally." />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col" aria-label="Settings sections">
          {SECTIONS.map((s) => {
            const on = s.id === active.id;
            return (
              <Link
                key={s.id}
                href={`/settings?section=${s.id}`}
                aria-current={on ? "page" : undefined}
                className={cx(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                  on ? "bg-panel font-medium text-fg shadow-card ring-1 ring-line" : "text-ink-2 hover:bg-panel hover:text-fg",
                )}
              >
                <s.icon className={cx("h-4 w-4", on ? "text-accent" : "text-muted")} aria-hidden />
                {s.title}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">
          <Card title={active.title} icon={active.icon} subtitle={active.description}>
            {active.fields && (
              <form action={saveSettingsSectionAction} className="grid gap-5">
                <input type="hidden" name="section" value={active.id} />
                {active.fields.map((f) => {
                  const v = getPath(cfg, f.path);
                  const value = Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v);
                  const name = `cfg.${f.type === "textarea" ? "text" : f.type}.${f.path}`;
                  const id = `f-${f.path}`;
                  return (
                    <div key={f.path} className="grid gap-1.5 md:grid-cols-[240px_1fr] md:gap-6">
                      <div>
                        <label htmlFor={id} className="text-sm font-medium text-fg">
                          {f.label}
                        </label>
                        {f.help && <p className="mt-0.5 text-xs text-muted">{f.help}</p>}
                      </div>
                      {f.options && f.type === "list" ? (
                        <MultiCombobox name={name} options={known[f.options]} defaultValues={Array.isArray(v) ? (v as string[]) : []} placeholder="Add…" aria-label={f.label} />
                      ) : f.options ? (
                        <Combobox name={name} options={known[f.options]} defaultValue={value} placeholder={f.placeholder ?? "Choose or type…"} aria-label={f.label} />
                      ) : f.type === "textarea" ? (
                        <textarea id={id} name={name} defaultValue={value} rows={3} className={cx(inputCls, f.mono && "font-mono text-xs")} />
                      ) : (
                        <input
                          id={id}
                          name={name}
                          defaultValue={value}
                          type={f.type === "num" ? "number" : "text"}
                          min={f.type === "num" ? 0 : undefined}
                          placeholder={f.placeholder}
                          className={cx(inputCls, f.mono && "font-mono text-xs", f.type === "num" && "max-w-40")}
                        />
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center gap-3 border-t border-line pt-4">
                  <Button type="submit">Save changes</Button>
                  {active.id === "jira" && (
                    <Button variant="secondary" type="submit" formAction={testJiraAction} disabled={!cfg.jira.baseUrl || !jiraAuthHeader()}>
                      Test connection
                    </Button>
                  )}
                </div>
              </form>
            )}

            {active.id === "credentials" && <Credentials />}

            {active.id === "assistant" && <AssistantSettings cfg={cfg} />}

            {active.id === "advanced" && (
              <div className="grid gap-4">
                <form action={saveSettingsAction} className="grid gap-2">
                  <label className="text-sm font-medium text-fg" htmlFor="raw-config">
                    Raw configuration (JSON)
                  </label>
                  <textarea
                    id="raw-config"
                    name="config"
                    rows={28}
                    defaultValue={JSON.stringify(cfg, null, 2)}
                    className={inputCls + " font-mono text-xs"}
                    spellCheck={false}
                  />
                  <div>
                    <Button type="submit">Save JSON</Button>
                  </div>
                </form>
                <form action={resetSettingsAction} className="border-t border-line pt-4">
                  <p className="mb-2 text-sm text-ink-2">Put every setting back to its default. Your data isn&rsquo;t touched.</p>
                  <Button variant="danger" type="submit">
                    Reset to defaults
                  </Button>
                </form>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function Credentials() {
  const rows: [string, string, boolean][] = [
    ["JIRA_PAT", "Jira personal access token (Jira 8.14+)", !!process.env.JIRA_PAT],
    ["JIRA_USER / JIRA_PASSWORD", "Basic auth for older Jira without tokens", !!(process.env.JIRA_USER && process.env.JIRA_PASSWORD)],
    ["CONFLUENCE_PAT", "Confluence token (falls back to JIRA_PAT)", !!process.env.CONFLUENCE_PAT],
    ["GOOGLE_ACCESS_TOKEN", "Read private Google Docs meeting notes", !!process.env.GOOGLE_ACCESS_TOKEN],
    ["NODE_EXTRA_CA_CERTS", "Corporate certificate authority bundle", !!process.env.NODE_EXTRA_CA_CERTS],
    ["ANTHROPIC_API_KEY", "Key for the assistant's AI endpoint (see Settings → Assistant)", !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)],
  ];
  return (
    <div className="grid gap-4">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {rows.map(([name, what, set]) => (
          <li key={name} className="flex items-center gap-3 px-4 py-3">
            {set ? <CheckCircle2 className="h-4 w-4 text-good" aria-label="Set" /> : <XCircle className="h-4 w-4 text-muted" aria-label="Not set" />}
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-semibold text-fg">{name}</div>
              <div className="text-xs text-muted">{what}</div>
            </div>
            <span className={cx("text-xs font-medium", set ? "text-good-ink" : "text-muted")}>{set ? "Set" : "Not set"}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-2">
        Put these in <code className="rounded bg-panel-2 px-1">.env.local</code> in the app folder, then restart the app. With the desktop runner, run{" "}
        <code className="rounded bg-panel-2 px-1">npm run desktop:stop</code> and then <code className="rounded bg-panel-2 px-1">npm run desktop:install</code>.
      </p>
    </div>
  );
}

const MODES: { value: "" | "off" | "demo" | "on"; label: string; help: string }[] = [
  { value: "off", label: "Off", help: "The chat panel shows how to turn it on, and nothing is sent anywhere." },
  {
    value: "demo",
    label: "Demo data only",
    help: "Works only while the fictional demo data is loaded, and pauses itself as soon as real Jira data is in the app. The safe way to try it.",
  },
  {
    value: "on",
    label: "On, with real data",
    help: "Questions send your messages and the program data the assistant looks up to the endpoint below. Only once that endpoint is approved for this data.",
  },
  { value: "", label: "Follow .env.local", help: "Use ASSISTANT_ENABLED from the environment instead of this setting." },
];

function AssistantSettings({ cfg }: { cfg: AppConfig }) {
  const db = getDb();
  const eff = assistantConfig(db);
  const st = assistantStatus(db);
  const a = cfg.assistant;
  const envMode = process.env.ASSISTANT_ENABLED?.trim();
  return (
    <div className="grid gap-6">
      <div
        className={cx(
          "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
          st.available ? "border-good/40 bg-good-soft text-good-ink" : "border-line bg-panel-2 text-ink-2",
        )}
      >
        {st.available ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />}
        <div>
          <div className="font-medium text-fg">
            {st.available ? (st.mode === "demo" ? "On for demo data only" : "On") : "Not available"}
            <span className="font-normal text-muted">
              {" "}
              · {eff.model} · {eff.baseURL ?? "Anthropic API (default)"}
            </span>
          </div>
          {st.reason && <p className="mt-0.5">{st.reason}</p>}
          {st.available && <p className="mt-0.5">Open it with the Ask button at the bottom right, or ⌘J / Ctrl+J.</p>}
        </div>
      </div>

      <form action={saveAssistantSettingsAction} className="grid gap-6">
        <fieldset className="grid gap-1.5 md:grid-cols-[240px_1fr] md:gap-6">
          <legend className="sr-only">Mode</legend>
          <div>
            <div className="text-sm font-medium text-fg">Mode</div>
            <p className="mt-0.5 text-xs text-muted">Changes apply right away; no restart needed.</p>
          </div>
          <div className="grid gap-2">
            {MODES.map((mo) => (
              <label
                key={mo.value || "env"}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line px-3 py-2.5 transition hover:border-line-strong has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input type="radio" name="mode" value={mo.value} defaultChecked={a.mode === mo.value} className="mt-1" />
                <span>
                  <span className="block text-sm font-medium text-fg">
                    {mo.label}
                    {mo.value === "" && envMode && <span className="font-normal text-muted"> (currently {envMode})</span>}
                  </span>
                  <span className="block text-xs text-muted">{mo.help}</span>
                </span>
              </label>
            ))}
            <label className="mt-1 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2.5 text-sm text-warning-ink">
              <input type="checkbox" name="approved" defaultChecked={a.approvedForRealData} className="mt-1" />
              <span>
                <b>Required for &ldquo;On, with real data&rdquo;:</b> I confirm my organization has approved the endpoint below for this program&rsquo;s data.
              </span>
            </label>
          </div>
        </fieldset>

        <div className="grid gap-1.5 md:grid-cols-[240px_1fr] md:gap-6">
          <div>
            <label htmlFor="as-base" className="text-sm font-medium text-fg">Endpoint</label>
            <p className="mt-0.5 text-xs text-muted">
              Your company&rsquo;s approved AI gateway, or leave empty for {process.env.ANTHROPIC_BASE_URL ? <code>ANTHROPIC_BASE_URL</code> : "Anthropic's API"}.
            </p>
          </div>
          <input
            id="as-base"
            name="baseUrl"
            defaultValue={a.baseUrl}
            placeholder={process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com (default)"}
            className={cx(inputCls, "font-mono text-xs")}
          />
        </div>

        <div className="grid gap-1.5 md:grid-cols-[240px_1fr] md:gap-6">
          <div>
            <label htmlFor="as-model" className="text-sm font-medium text-fg">Model</label>
            <p className="mt-0.5 text-xs text-muted">Leave empty for the default. Your gateway may use its own model names.</p>
          </div>
          <input id="as-model" name="model" defaultValue={a.model} placeholder={process.env.ASSISTANT_MODEL || "claude-opus-5-5"} className={cx(inputCls, "font-mono text-xs max-w-sm")} />
        </div>

        <div className="grid gap-1.5 md:grid-cols-[240px_1fr] md:gap-6">
          <div>
            <label htmlFor="as-effort" className="text-sm font-medium text-fg">Effort</label>
            <p className="mt-0.5 text-xs text-muted">How hard it thinks before answering. Higher is more thorough, slower and costs more.</p>
          </div>
          <select id="as-effort" name="effort" defaultValue={a.effort} className={cx(inputCls, "max-w-56")}>
            <option value="">Default (medium)</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        <div className="grid gap-1.5 md:grid-cols-[240px_1fr] md:gap-6">
          <div>
            <label htmlFor="as-fb" className="text-sm font-medium text-fg">Fallback when a request is declined</label>
            <p className="mt-0.5 text-xs text-muted">Retries a declined request on another model, server-side. Gateways may not support it.</p>
          </div>
          <select id="as-fb" name="refusalFallback" defaultValue={a.refusalFallback} className={cx(inputCls, "max-w-80")}>
            <option value="auto">Automatic (on for Anthropic&rsquo;s API)</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </div>

        <div className="grid gap-1.5 md:grid-cols-[240px_1fr] md:gap-6">
          <div>
            <div className="text-sm font-medium text-fg">API key</div>
            <p className="mt-0.5 text-xs text-muted">Kept in .env.local, never in the database.</p>
          </div>
          <div className="flex items-start gap-2 text-sm">
            {eff.hasKey ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-good" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 text-muted" aria-hidden />}
            <span className="text-ink-2">
              {eff.hasKey ? (
                <>
                  <code className="rounded bg-panel-2 px-1">ANTHROPIC_API_KEY</code> is set.
                </>
              ) : (
                <>
                  Not set. Add <code className="rounded bg-panel-2 px-1">ANTHROPIC_API_KEY=…</code> to <code className="rounded bg-panel-2 px-1">.env.local</code> and restart the
                  app (see Credentials). It&rsquo;s sent as <code className="rounded bg-panel-2 px-1">Authorization: Bearer</code>.
                </>
              )}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="submit">Save changes</Button>
          <Button variant="secondary" type="submit" formAction={testAssistantAction} formNoValidate>
            Test connection
          </Button>
          <span className="text-xs text-muted">The test sends one short message with no program data, using the saved settings.</span>
        </div>
      </form>
    </div>
  );
}
