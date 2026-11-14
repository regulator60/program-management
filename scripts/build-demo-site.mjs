// Builds a static, read-only snapshot of the app on fictional demo data, for GitHub Pages.
//
//   PAGES_BASE_PATH=/program-management NEXT_PUBLIC_DEMO_MODE=1 npm run build
//   PAGES_BASE_PATH=/program-management node scripts/build-demo-site.mjs
//
// It starts the production server on a throwaway database (which seeds itself
// with demo data because NEXT_PUBLIC_DEMO_MODE=1), crawls every internal page,
// and writes the HTML plus Next's static assets to ./out.
// Never point this at a real database: the Pages site is public.

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const base = (process.env.PAGES_BASE_PATH ?? "").replace(/\/+$/, "");
const port = Number(process.env.DEMO_PORT ?? 3123);
const origin = `http://127.0.0.1:${port}`;
const out = "out";
const START = ["/", "/hierarchy", "/gantt", "/dependencies", "/raid", "/actions", "/notes", "/sync", "/settings", "/docs/jira-import"];
const MAX_PAGES = 400;

const tmp = mkdtempSync(join(tmpdir(), "pm-demo-"));
// Run Next directly (not via npx) in its own process group so we can stop it cleanly.
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port), "-H", "127.0.0.1"], {
  env: { ...process.env, DATABASE_PATH: join(tmp, "demo.db"), NEXT_PUBLIC_DEMO_MODE: "1" },
  stdio: ["ignore", "ignore", "inherit"],
  detached: true,
});
const stopServer = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stopServer);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${origin}${base}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Server did not start");
}

function internalLinks(html) {
  const links = new Set();
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    let href = m[1].replace(/&amp;/g, "&");
    if (!href.startsWith(`${base}/`) && href !== base) continue;
    href = href.slice(base.length).split(/[?#]/)[0] || "/";
    if (href.startsWith("/_next") || href.startsWith("/api/")) continue;
    links.add(decodeURIComponent(href));
  }
  return links;
}

function fileFor(path) {
  return path === "/" ? join(out, "index.html") : join(out, path, "index.html");
}

try {
  await waitForServer();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const queue = [...START];
  const seen = new Set(queue);
  let failures = 0;
  while (queue.length) {
    const path = queue.shift();
    const url = `${origin}${base}${path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`✗ ${res.status} ${path}`);
      failures++;
      continue;
    }
    const html = await res.text();
    const file = fileFor(path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
    for (const l of internalLinks(html)) {
      if (!seen.has(l) && seen.size < MAX_PAGES) {
        seen.add(l);
        queue.push(l);
      }
    }
  }

  // 404 page, static assets, and tell Pages not to run Jekyll (it hides _next/).
  const notFound = await fetch(`${origin}${base}/__missing__`);
  writeFileSync(join(out, "404.html"), await notFound.text());
  cpSync(".next/static", join(out, "_next", "static"), { recursive: true });
  if (existsSync("public")) cpSync("public", out, { recursive: true });
  writeFileSync(join(out, ".nojekyll"), "");

  console.log(`Wrote ${seen.size} pages to ${out}/ (base path "${base || "/"}")`);
  if (failures) process.exitCode = 1;
} finally {
  stopServer();
  rmSync(tmp, { recursive: true, force: true });
}
