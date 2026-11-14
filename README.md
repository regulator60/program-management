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
| **Executive overview** | Red/amber/green (RAG) status by sub-track or by platform (`Domain:` labels). Milestone, epic and item progress, dependency health, risks by tier, the next milestone, and the reason for each status. |
| **Plan hierarchy** | The collapsible tree. Each node shows its rolled-up progress. `OVERRUN` means child work finishes after the parent is due. `DEP×n` means the item has dependency conflicts. |
| **Gantt** | Milestones are diamonds, work is bars. Arrows show dependencies, and linked items from other tracks appear in their own section. |
| **Dependencies** | Every blocks / depends-on link touching your items, graded *conflict / overdue / tight / no date / ok / done*. It also lists which linked items **changed dates** recently. |
| **Risks & decisions** | Grouped by tier. Tier 3 is your track only; tiers 1 and 2 span multiple tracks. |
| **Action items** | Items from the Jira intake board (the `intake` label), plus items pulled out of your notes. |
| **Notes** | Paste meeting notes or import a Confluence page. Action items are extracted automatically (owner and due date included). |
| **Data & Jira sync** | Pull from Jira over REST or from an export file, import Google Sheets, and push staged edits back to Jira. |

Every view can be filtered by **sub-track** and **platform**. The filters are kept in the URL, so you can bookmark or share a view.

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

## Getting data in

- **Jira REST**: set `JIRA_PAT`, or `JIRA_USER`/`JIRA_PASSWORD`, then **Sync now**. This pulls your scope JQL, the intake JQL, and one hop of linked issues. Each sync records date and status changes, which powers the "dependency dates changed" view.
- **Jira export file**: when the app can't reach Jira, upload a "CSV (All fields)" export or a saved `/rest/api/2/search` JSON.
- **Confluence Server**: paste a page URL on **Notes**. Confluence task lists become action items.
- **Google Sheets**: paste a link-shared sheet URL or upload a CSV, either as action items or as a key → sub-track / platform mapping.

## Pushing changes back to Jira

Edits are staged locally and marked `PENDING`. Push them in one of two ways:

- **Download a CSV** for Jira's External System Import. This is the recommended route for a finicky Jira.
- **Push via REST**, throttled to one issue at a time.

Step-by-step instructions are in [`docs/JIRA_IMPORT.md`](docs/JIRA_IMPORT.md), and in the app at `/docs/jira-import`.

## Code map

- `src/lib/jira/`: REST client, normalisation, classification, file import, CSV export
- `src/lib/hierarchy.ts`: builds the tree and roll-ups
- `src/lib/dependencies.ts`: predecessor/successor analysis
- `src/lib/model.ts`: loads everything and produces the executive roll-up
- `src/lib/store.ts`: SQLite access, staged edits, change history
- `src/app/`: pages (server components) and server actions
