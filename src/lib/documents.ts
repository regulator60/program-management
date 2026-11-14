import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { attachmentsDir } from "./db";
import { toIsoDate } from "./jira/classify";
import { htmlToText } from "./notes";

// ---------------- Google Docs ----------------

export function parseGoogleDocId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/) ?? s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{25,}$/.test(s) ? s : null;
}

export type FetchedDoc = { id: string; title: string; text: string; modifiedTime: string | null; url: string };

/**
 * Fetch a Google Doc as plain text.
 *
 * - With GOOGLE_ACCESS_TOKEN set (an OAuth token with Drive read scope, e.g.
 *   `gcloud auth print-access-token --scopes=https://www.googleapis.com/auth/drive.readonly`),
 *   private docs you can open work via the Drive API.
 * - Without it, the doc must be shared "anyone with the link can view" or
 *   published. Otherwise download it (File → Download → .docx/.txt) and attach it.
 */
export async function fetchGoogleDoc(input: string): Promise<FetchedDoc> {
  const id = parseGoogleDocId(input);
  if (!id) throw new Error("That doesn't look like a Google Docs link (…/document/d/<id>/…).");
  const url = `https://docs.google.com/document/d/${id}/edit`;
  const token = process.env.GOOGLE_ACCESS_TOKEN;

  if (token) {
    const auth = { Authorization: `Bearer ${token}` };
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${id}?fields=name,modifiedTime&supportsAllDrives=true`,
      { headers: auth, cache: "no-store" },
    );
    if (!metaRes.ok) throw new Error(`Google Drive → ${metaRes.status}. Is GOOGLE_ACCESS_TOKEN valid and can you open the doc?`);
    const meta = (await metaRes.json()) as { name: string; modifiedTime?: string };
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`, {
      headers: auth,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Google Drive export → ${res.status}`);
    return { id, title: meta.name, text: cleanDocText(await res.text()), modifiedTime: meta.modifiedTime ?? null, url };
  }

  const res = await fetch(`https://docs.google.com/document/d/${id}/export?format=txt`, {
    cache: "no-store",
    redirect: "follow",
  });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith("<")) {
    throw new Error(
      "Couldn't read the doc without signing in. Share it as \"anyone with the link\", set GOOGLE_ACCESS_TOKEN, or download it as .docx and attach it.",
    );
  }
  const disp = res.headers.get("content-disposition") ?? "";
  const fname =
    decodeURIComponent(disp.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? "") ||
    disp.match(/filename="([^"]+)"/i)?.[1] ||
    "Google Doc";
  return { id, title: fname.replace(/\.txt$/i, ""), text: cleanDocText(text), modifiedTime: null, url };
}

function cleanDocText(t: string) {
  return t.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Meeting date from a title like "Digital sync - 2026/11/12 10:00 EST - Notes by Gemini",
 * "Weekly sync 11/12/2026" or "2026-11-12 standup".
 */
export function dateFromTitle(title: string): string | null {
  const m = title.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const us = title.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (us) return toIsoDate(`${us[1]}/${us[2]}/${us[3]}`);
  const mon = title.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (mon) return toIsoDate(`${mon[2]}/${mon[1].slice(0, 3)}/${mon[3]}`);
  return null;
}

// ---------------- Attached files ----------------

export const ACCEPTED_NOTE_FILES = ".docx,.txt,.md,.html,.htm";

/** Extract text from an attached notes file (Google Docs downloads: .docx, .txt, .md, .html). */
export function documentToText(name: string, bytes: Buffer): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".docx") return docxToText(bytes);
  const text = bytes.toString("utf8");
  if (ext === ".html" || ext === ".htm" || /^\s*<(!doctype|html)/i.test(text)) return htmlToText(text);
  return cleanDocText(text);
}

/** Save the original file next to the database. Returns its path. */
export function storeAttachment(noteId: number, name: string, bytes: Buffer): string {
  const dir = attachmentsDir();
  mkdirSync(dir, { recursive: true });
  const safe = name.replace(/[^\w.\- ]+/g, "_").slice(-120) || "notes";
  const path = join(dir, `${noteId}-${safe}`);
  writeFileSync(path, bytes);
  return path;
}

// ---------------- .docx (zip + WordprocessingML), no dependencies ----------------

/** Read one entry from a zip archive (stored or deflated). */
export function readZipEntry(zip: Buffer, wanted: string): Buffer | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid .docx (zip) file.");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) break;
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const lNameLen = zip.readUInt16LE(local + 26);
      const lExtraLen = zip.readUInt16LE(local + 28);
      const start = local + 30 + lNameLen + lExtraLen;
      const data = zip.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`Unsupported zip compression method ${method}`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function docxToText(bytes: Buffer): string {
  const xml = readZipEntry(bytes, "word/document.xml")?.toString("utf8");
  if (!xml) throw new Error("No word/document.xml in this .docx.");
  const paras: string[] = [];
  for (const p of xml.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    const isList = /<w:numPr>/.test(p);
    const isHeading = /<w:pStyle w:val="(?:Heading|Title)/i.test(p);
    const parts: string[] = [];
    for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      parts.push(m[1] ?? (m[0] === "<w:tab/>" ? "\t" : "\n"));
    }
    const text = parts
      .join("")
      .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => XML_ENTITIES[e])
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
    if (!text.trim()) {
      paras.push("");
      continue;
    }
    paras.push(isList ? `- ${text.trim()}` : isHeading ? `# ${text.trim()}` : text);
  }
  return cleanDocText(paras.join("\n"));
}
