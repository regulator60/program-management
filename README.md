# Track PM

A program management tool for running one track of a large program, built around Jira Server / Data Center.

It works through this hierarchy:

```
Outcome
 └─ Critical Path Milestone                    ("contains" link)
     └─ Interim Milestone with the Intent label ("contains" link)
         └─ Interim Milestone                    ("contains" link)
             └─ Epic                              ("contains" link)
                 └─ Stories / tasks / bugs        (Epic Link / parent)
```

## Views

| Page | What it shows |
| --- | --- |
| **Executive overview** | Overall status with a one-sentence summary that names what is threatened and why; KPI tiles; a **briefing** (see below); critical path milestones; a 120-day milestone roadmap; status cards by sub-track or platform; dependency watch; and tier 1–2 risks and decisions. Prints cleanly to PDF. |
| **S0 weekly review** | One page per sub-track and per platform for the weekly call with the people doing the work and the track leads. It opens with that team's **briefing**, then a generated **agenda** (wins; issues to discuss, each with a question to put to the team; **risks & decisions to review**; program asks; overdue actions; dates that moved), what changed this week, upcoming milestones, dependencies (what we wait on, who waits on us), risks, decisions, that team's program asks with one-click "done", its action items, and quick capture of new actions. A risk or decision is raised for review when there's no update in N days (Settings → Analysis), it was last marked blocked or stalled, its date is past or within 14 days, or it has no owner. Capture an **update** (Moving / Stalled / Blocked / Resolved plus a note) right on the page, optionally staged as a Jira comment. Updates also show on each item's page. Printable. |
| **Plan hierarchy** | The collapsible tree. Each node shows its rolled-up progress. `OVERRUN` means child work finishes after the parent is due. `DEP×n` means the item has dependency conflicts. |
| **Timeline** | An interactive Gantt chart. Work is shown as bars with a progress fill, milestones as diamonds, and dependencies as curved arrows colored by health. **Hover** any row or bar to highlight what it's connected to (its parents, children, and what it depends on or is needed by); everything else fades. **Click** to pin a details panel with status, owner, dates, progress, the plan it's part of, and its dependencies, each linking to its own page. **Double-click** opens the item, and clicking an arrow opens that dependency. You can zoom by weeks, months or quarters, jump to today, and collapse rows down to milestones. The item column and date header stay in place as you scroll. Milestones whose child work runs late show a red dashed overrun, and linked work from other tracks is hatched in its own section. |
| **Dependencies** | Every blocks / depends-on link touching your items, graded *conflict / overdue / tight / no date / ok / done*. It also lists which linked items **changed dates** recently. Each dependency has **its own page** (`/dependencies/<from>/<to>`), opened from anywhere a dependency is shown. It has both sides with dates, owners and teams; an **Ask next** question grounded in your records; updates on the dependency (optionally staged as a Jira comment on your side); meeting-note lines that mention it; date history; the milestone and outcome it puts at risk; and its action items, with a form to add more. You can also stage date changes on either side. |
| **Risks & decisions** | Grouped by tier. Tier 3 is your track only; tiers 1 and 2 span multiple tracks. |
| **Action items** | Two kinds. **Program action items** are asks from the program, from the Jira intake board (the `intake` label) or added in the app. Each is assigned to sub-tracks and/or platforms, and every team marks its own part done. Intake items labelled `Domain:` assign themselves to those platforms. When all teams finish, one click stages the Jira item to Done with a summary comment. **Team action items** are smaller follow-ups from calls and notes. Each belongs to a sub-track and/or platform and links to the milestones, dependencies and risks it moves forward. Jira keys in the text are linked automatically, and actions under a team heading in notes are assigned to that team. |
| **Meeting notes** | Import a Google Doc, attach a downloaded file (.docx/.txt/.md/.html), paste text, or pull a Confluence page. Action items are extracted automatically (owner and due date included), and Jira updates are suggested for you to review and stage. |
| **Settings** | Sections for General, Jira connection (with a connection test), Confluence, Issue types, Fields, Labels & links, Analysis thresholds, Credentials (which environment variables are set) and Advanced (raw JSON, reset). |
| **Data & Jira sync** | Pull from Jira over REST or from an export file, import Google Sheets, and push staged edits back to Jira. |

Press **⌘K** (Ctrl+K on Windows) or **/** anywhere to search every issue, milestone, risk and page. Every view can be filtered by **sub-track** and **platform**. The filters are kept in the URL, so you can bookmark or share a view.

## Run it

```bash
npm ci
cp .env.example .env.local   # add JIRA_PAT etc.
npm run dev                  # http://localhost:3000
npm test
```

Then:

1. Open **Data & Jira sync → Load demo data** to try the app on a fictional track.
2. Fill in **Settings** to map it onto your Jira: base URL, scope JQL, issue type names, custom field ids (from `/rest/api/2/field`) and label conventions.

> This app is built to run **locally for one user**: it has no login. Add authentication before you host it anywhere shared.

### Keep it running on your desktop

To run the app on your own computer, start it at login, and have it update itself when `main` changes:

```bash
git clone https://github.com/regulator60/program-management.git ~/track-pm && cd ~/track-pm
cp .env.example .env.local   # add tokens
npm run desktop:install      # macOS, Linux or Windows
```

Each new commit on `main` is built and tested on the side before it replaces the running version. If anything fails, the old version keeps running. Details are in [`docs/DESKTOP.md`](docs/DESKTOP.md).

### Briefings

The executive overview and each S0 page start with a briefing in three columns. Each item names the work, the people and the dates, and says what is on record about it:

- **Needs attention:** what threatens the plan, and why. This covers dependency conflicts and overdue dependencies, grouped by the critical path milestone they put at risk; late milestones; plans whose child work finishes after the parent is due; and dates we're late on for other tracks. Example: "Account dashboard GA (BIGP-11, due Mar 16) is at risk from a cross-track dependency. View Account's Balances API v3 (VIEW-50) lands Jan 25, 30 days after Accounts aggregation API (BIGP-103) needs it (Dec 26). It moved out 25 days on Nov 14. Jordan Kim is working on it: 'Draft re-plan options…' (due Nov 21)."
- **Needs help:** what is stuck, unowned or overdue. This covers items last marked blocked or stalled, dependencies with no committed date, decisions due within 14 days, tier 1–2 risks with no recent update, and overdue actions and program asks.
- **Moving forward:** milestones completed in the last two weeks, dependency dates that were pulled in, and updates marked moving or resolved.

When nothing is on record for a threat, the briefing says so ("No action item or update on record yet"), so the gap is visible in the call. In a sub-track or platform view, a team is only flagged for its own work.

### Smart questions

The questions in S0 agendas, on dependency pages and on item pages come from your own records, not a generic script. For each item the app gathers the action items linked to it (or mentioning its key), the meeting-note lines that mention it, and its status updates. It then asks about the most relevant one:

1. An **overdue action**: "Sam Patel: 'Get a committed date for fraud scoring API' was due Nov 13. Is it done, and what did it turn up?"
2. A **blocked or stalled update**: "On Nov 5 this was blocked: 'No response from View Account'. Is that still the case, and who can move it?"
3. An **open action**: "Jordan Kim: how is 'Draft re-plan options' going (due Nov 20)?"
4. The **last update**, then the latest **meeting-note mention**.

Each question shows what it's "Based on". It falls back to a generic question only when there's nothing on record.

### Pickers

Wherever a value repeats, you pick instead of typing:
- **Owners:** people from Jira and from action items.
- **Linked Jira items:** each with its key and summary.
- **Labels, statuses, and issue types** (in Settings).

You can always type a value that isn't in the list and press Enter to add it.

## Getting data in

- **Jira REST**: set `JIRA_PAT`, or `JIRA_USER`/`JIRA_PASSWORD`, then **Sync now**. This pulls your scope JQL, the intake JQL, and one hop of linked issues. Each sync records date and status changes, which powers the "dependency dates changed" view.
- **Jira export file**: when the app can't reach Jira, upload a "CSV (All fields)" export or a saved `/rest/api/2/search` JSON.
- **Google Docs meeting notes**: paste the doc link on **Meeting notes**. Link-shared docs work as-is; for private docs set `GOOGLE_ACCESS_TOKEN`, or download the doc and attach the file. Re-importing (or **Refresh**) updates the note and only adds new action items, so a running notes doc works.
- **Confluence Server**: paste a page URL on **Meeting notes**. Confluence task lists become action items.
- **Google Sheets**: paste a link-shared sheet URL or upload a CSV, either as action items or as a key → sub-track / platform mapping.

## Meeting notes → action items → Jira

Where things are stored:

- **The note text and its action items** go in the local SQLite database.
- **An attached original file** is saved in `data/attachments/`, next to the database. It stays out of git because this repo is public.
- **A Google Doc** stays the source of truth. The app keeps its link so you can refresh the note.

What gets extracted:

- **Action items.** The app recognises `- [ ]` and ☐ checkboxes, the prefixes `AI:` / `Action:` / `TODO:` / `Follow-up:`, `@name to …` and `Name will …`. Every line under an "Action items", "Next steps" or "Suggested next steps" heading also counts, which covers Gemini meeting notes.
- **Suggested Jira updates.** These come from any line that names a known issue key:
  - a date plus a scheduling word (moved, slipped, due, target, …) suggests a new due or start date
  - done / shipped suggests status Done
  - started / kicked off suggests In Progress
  - the line itself is suggested as a comment on that issue

Untick or edit any suggestion, then **Stage selected**. Nothing goes to Jira until you push.

## Pushing changes back to Jira

Edits are staged locally and marked `PENDING`. Push them in one of two ways:

- **Download a CSV** for Jira's External System Import. This is the recommended route for a finicky Jira.
- **Push via REST**, throttled to one issue at a time.

Step-by-step instructions are in [`docs/JIRA_IMPORT.md`](docs/JIRA_IMPORT.md), and in the app at `/docs/jira-import`.

## Demo site (GitHub Pages)

`.github/workflows/pages.yml` builds a **read-only static snapshot on fictional demo data** on every push. Pushes to `main` then deploy it to `https://<owner>.github.io/<repo>/`.

One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. If it stays on "Deploy from a branch", GitHub's built-in Jekyll build publishes the README and races this workflow on every push.

To build it locally:

```bash
PAGES_BASE_PATH=/program-management NEXT_PUBLIC_DEMO_MODE=1 npm run build:demo-site   # writes ./out
```

GitHub Pages only serves static files, so the real app (sync, edits, imports) can't run there; run it locally. The repo and the Pages site are **public**, so never put real program data in either. To run the app with real data, see [`docs/HOSTING.md`](docs/HOSTING.md).

## Code map

- `src/lib/jira/`: REST client, normalisation, classification, file import, CSV export
- `src/lib/hierarchy.ts`: builds the tree and roll-ups
- `src/lib/dependencies.ts`: predecessor/successor analysis
- `src/lib/model.ts`: loads everything and produces the executive roll-up
- `src/lib/insights.ts`: ranks what needs attention
- `src/lib/brief.ts`, `src/components/Briefing.tsx`: the briefing call-outs and status summary
- `src/components/ui.tsx`, `src/components/select.tsx`, `src/app/globals.css`: design system (tokens, badges, tables, cards; Radix UI dropdowns)
- `src/lib/s0.ts`: S0 agenda and risk/decision review topics
- `src/lib/context.ts`: per-item context (actions, note mentions, updates) and grounded questions
- `src/components/combobox.tsx`, `src/lib/options.ts`: type-ahead pickers and their known values
- `src/lib/store.ts`: SQLite access, staged edits, change history
- `src/lib/notes.ts`, `src/lib/noteInsights.ts`, `src/lib/documents.ts`: action-item extraction, Jira suggestions, Google Docs / .docx reading
- `scripts/build-demo-site.mjs`: static snapshot for GitHub Pages
- `scripts/desktop-runner.mjs`: runs the app on your desktop and updates it from `main`
- `src/app/`: pages (server components) and server actions
