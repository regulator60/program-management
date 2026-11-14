# Working agreements

@AGENTS.md

## Git workflow
- **Always work on a feature branch** named `feature/<short-topic>`, created from the latest `main`
  (or from the branch the work builds on, if it hasn't merged yet). Never commit directly to `main`.
- Push the feature branch and open a pull request into `main` when asked. Merging to `main` deploys the demo site.

## Pull request descriptions
Every PR gets a full description that follows `.github/pull_request_template.md`:
- **Summary:** what changed and why.
- **What's in it:** every user-visible and notable internal change, grouped by area. Include new settings, env vars, schema migrations, and any manual steps (for example a repo setting to change).
- **Data and safety:** effects on Jira writes, stored data, credentials, or the public demo site.
- **Test plan:** the exact commands run, their results, and any browser checks.
- **Follow-ups:** known gaps and decisions still needed.

If a PR is merged without a description, backfill it afterwards.

## This repository is public
- Never commit real Jira, Confluence, Google Docs or meeting-note content, tokens, internal hostnames
  or company-specific configuration. Real data lives only in the local SQLite database (`data/`, gitignored)
  and attachments under `data/attachments/` (gitignored). Secrets go in `.env.local` (gitignored).
- The GitHub Pages site (`.github/workflows/pages.yml`) is a static snapshot built from fictional demo data
  (`src/lib/seed.ts`) only.

## Checks before pushing
`npm test`, `npx eslint src scripts`, `npm run build`.
