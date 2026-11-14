import { connection } from "next/server";
import { Suspense } from "react";
import { resetSettingsAction, saveSettingsAction, testJiraAction } from "@/app/actions";
import { Button, Card, PageHeader, inputCls } from "@/components/ui";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { jiraAuthHeader } from "@/lib/jira/client";

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <Settings />
    </Suspense>
  );
}

const HELP: [string, string][] = [
  ["trackName", "Shown on the executive overview."],
  ["jira.baseUrl", "Jira Server root, e.g. https://jira.yourco.com (no trailing /browse)."],
  ["jira.scopeJql", "Returns everything in your track: outcomes, milestones, epics, stories, risks, decisions."],
  ["jira.intakeJql", 'Program action items, e.g. project = BIGP AND labels = intake. Leave "" to skip.'],
  ["jira.writeDelayMs", "Pause between REST writes when pushing."],
  ["issueTypes.*", "Exact Jira issue type names for each level. Interim milestones are split on labels.intent."],
  ["fields.startDate / dueDate / epicLink", "Field ids. Find them at /rest/api/2/field on your Jira. dueDate is usually \"duedate\"."],
  ["fields.tier / subTrack", "Optional custom field ids. Blank = derive from labels (labels.tierPattern, labels.subTrackPrefix)."],
  ["csvColumns.*", "Column names used in the update CSV; match them to fields in Jira's importer."],
  ["labels.platformPrefix", 'Platform labels, e.g. "Domain:" → Domain:iOS becomes platform iOS.'],
  ["links.containsOutward", 'Outward verb of the hierarchy link type ("contains").'],
  ["analysis.bufferDays", "Dependencies with less buffer than this are flagged as tight."],
];

async function Settings() {
  await connection();
  const cfg = getConfig(getDb());
  return (
    <>
      <PageHeader title="Settings" subtitle="Maps the app onto your Jira. Saved in the local SQLite database." />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <Card title="Configuration (JSON)">
          <form action={saveSettingsAction} className="grid gap-2">
            <textarea name="config" rows={36} defaultValue={JSON.stringify(cfg, null, 2)} className={inputCls + " font-mono text-xs"} spellCheck={false} />
            <div className="flex gap-2">
              <Button type="submit">Save</Button>
            </div>
          </form>
          <form action={resetSettingsAction} className="mt-2">
            <Button variant="secondary" type="submit">Reset to defaults</Button>
          </form>
        </Card>
        <div className="grid content-start gap-6">
          <Card title="Credentials">
            <p className="mb-2 text-sm">
              Tokens are read from environment variables, never stored in the database. Put them in{" "}
              <code>.env.local</code> and restart:
            </p>
            <pre className="mb-3 rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{`JIRA_PAT=...           # Jira personal access token
CONFLUENCE_PAT=...     # Confluence PAT (falls back to JIRA_PAT)
# or, for older Jira without PATs:
JIRA_USER=...
JIRA_PASSWORD=...
# corporate CA bundle, if needed:
NODE_EXTRA_CA_CERTS=/path/to/ca.pem`}</pre>
            <p className="mb-2 text-sm">Jira credentials: {jiraAuthHeader() ? <b className="text-emerald-600">found</b> : <b className="text-amber-600">not set</b>}</p>
            <form action={testJiraAction}>
              <Button variant="secondary" type="submit" disabled={!cfg.jira.baseUrl || !jiraAuthHeader()}>Test Jira connection</Button>
            </form>
          </Card>
          <Card title="What the keys mean">
            <dl className="grid gap-2 text-xs">
              {HELP.map(([k, v]) => (
                <div key={k}>
                  <dt className="font-mono font-semibold">{k}</dt>
                  <dd className="text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
