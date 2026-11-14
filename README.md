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
| **Executive overview** | Overall status with a generated summary; KPI tiles; **What needs attention**, a ranked list of late milestones, plans that overrun, dependency conflicts traced to the critical path milestone they threaten, date slips by other tracks, tier 1/2 risks, due decisions and overdue actions; a 120-day milestone roadmap; and status cards by sub-track or platform. Prints cleanly to PDF. |
| **Plan hierarchy** | The collapsible tree. Each node shows its rolled-up progress. `OVERRUN` means child work finishes after the parent is due. `DEP×n` means the item has dependency conflicts. |
| **Gantt** | Milestones are diamonds, work is bars. Arrows show dependencies, and linked items from other tracks appear in their own section. |
| **Dependencies** | Every blocks / depends-on link touching your items, graded *conflict / overdue / tight / no date / ok / done*. It also lists which linked items **changed dates** recently. |
| **Risks & decisions** | Grouped by tier. Tier 3 is your track only; tiers 1 and 2 span multiple tracks. |
| **Action items** | Items from the Jira intake board (the `intake` label), plus items pulled out of your notes. |
| **Meeting notes** | Import a Google Doc, attach a downloaded file (.docx/.txt/.md/.html), paste text, or pull a Confluence page. Action items are extracted automatically (owner and due date included), and Jira updates are suggested for you to review and stage. |
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
- `src/lib/insights.ts`: ranks what needs attention and writes the summary
- `src/components/ui.tsx`, `src/app/globals.css`: design system (tokens, badges, tables, cards)
- `src/lib/store.ts`: SQLite access, staged edits, change history
- `src/lib/notes.ts`, `src/lib/noteInsights.ts`, `src/lib/documents.ts`: action-item extraction, Jira suggestions, Google Docs / .docx reading
- `scripts/build-demo-site.mjs`: static snapshot for GitHub Pages
- `scripts/desktop-runner.mjs`: runs the app on your desktop and updates it from `main`
- `src/app/`: pages (server components) and server actions
