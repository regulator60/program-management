# Running the app with real data

There are two builds of this app:

- **Demo site.** A static snapshot on fictional data, deployed to GitHub Pages by `.github/workflows/pages.yml`. It exists to show what the app does.
- **The real app.** A Next.js server with a SQLite database that talks to Jira, Confluence and Google. It needs a server process, network access to your Jira, and credentials.

## Why the real app can't use GitHub Pages or GitHub-hosted Actions

1. **Everything there is public.** This repository is public, so its Pages site is public too. Restricting who can view a Pages site needs GitHub Enterprise Cloud with a private repository. Jira issues, risks, decisions and meeting notes are confidential, so they must never be built into the site or committed to this repo.
2. **Pages only serves static files.** Sync, edits, imports and Jira pushes all need a running server. A static snapshot can't do any of them.
3. **GitHub-hosted runners can't reach your Jira.** They run on the public internet. A Jira Server or Data Center instance behind a corporate network or VPN isn't reachable from them, and it shouldn't be opened up so that it is.
4. **Credentials.** Putting a personal Jira token into a public repository's Actions secrets, so it can run against company systems, is very likely against company policy.

## Option A: run it locally (recommended for now)

This is the current design. It's one user on a laptop that's on the corporate network:

```bash
cp .env.example .env.local      # JIRA_PAT, CONFLUENCE_PAT, GOOGLE_ACCESS_TOKEN, NODE_EXTRA_CA_CERTS
npm ci
npm run build
npm start -- -H 127.0.0.1       # http://127.0.0.1:3000, reachable only from this machine
```

The data stays in `data/app.db` and `data/attachments/` on your machine.

## Option B: host it internally for a team

Do this through your company's approved platform, not through this public repository:

1. **Move the code into the company's source control,** for example GitHub Enterprise or an internal Git server, and work from that copy.
2. **Run CI/CD on a self-hosted runner inside the network** (`runs-on: [self-hosted, internal]`), so it can reach Jira and the internal container registry.
3. **Package the app as a container** and deploy it to an internal platform (Kubernetes, ECS, or a VM). It needs:
   - **Authentication:** single sign-on in front of the app, for example an OIDC reverse proxy. The app has no login of its own, and its server actions are unauthenticated.
   - **Persistent storage:** a volume for SQLite, or a move to Postgres if several instances will run.
   - **Secrets:** a Jira service account token in the company's secrets manager, not a personal token.
   - **TLS:** the internal certificate authority, via `NODE_EXTRA_CA_CERTS`.
4. **Get a security and data-classification review** before it holds real program data.

An internal deploy workflow would look roughly like this. It's a sketch and isn't active in this repository:

```yaml
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: [self-hosted, internal]
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t registry.internal/track-pm:${{ github.sha }} .
      - run: docker push registry.internal/track-pm:${{ github.sha }}
      - run: ./deploy.sh ${{ github.sha }}   # e.g. kubectl/helm against the internal cluster
```

## Option C: share read-only reports

To show leadership the status without hosting anything, the best route is a report export. The app would run locally against real data and produce a static file you share through internal tools (Confluence, a shared drive or email). That isn't built yet; it's a good next feature.
