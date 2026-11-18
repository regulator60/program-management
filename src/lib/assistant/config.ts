import type { DatabaseSync } from "node:sqlite";

/**
 * The assistant is OFF unless ASSISTANT_ENABLED is set in .env.local:
 *   ASSISTANT_ENABLED=demo  only while the database holds the fictional demo data
 *   ASSISTANT_ENABLED=on    with real data too (only once an approved endpoint is configured)
 *
 * Where requests go (read by the Anthropic SDK itself):
 *   ANTHROPIC_BASE_URL  e.g. your company's approved gateway; default is Anthropic's API
 *   ANTHROPIC_API_KEY   (or ANTHROPIC_AUTH_TOKEN); sent as "Authorization: Bearer"
 * Optional:
 *   ASSISTANT_MODEL     default claude-opus-5-5
 *   ASSISTANT_EFFORT    low | medium | high (default medium)
 *   ASSISTANT_REFUSAL_FALLBACK  1/0: retry declined requests on another model server-side.
 *                       Default on for Anthropic's API, off when ANTHROPIC_BASE_URL is set
 *                       (gateways may not support it).
 */
export type AssistantMode = "off" | "demo" | "on";

export function assistantConfig() {
  const raw = (process.env.ASSISTANT_ENABLED ?? "").trim().toLowerCase();
  const mode: AssistantMode = ["1", "true", "on", "yes"].includes(raw) ? "on" : raw === "demo" ? "demo" : "off";
  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim() || null;
  const effort = (process.env.ASSISTANT_EFFORT ?? "").trim().toLowerCase();
  const fb = process.env.ASSISTANT_REFUSAL_FALLBACK?.trim();
  return {
    mode,
    model: process.env.ASSISTANT_MODEL?.trim() || "claude-opus-5-5",
    effort: (["low", "medium", "high"].includes(effort) ? effort : "medium") as "low" | "medium" | "high",
    baseURL,
    fallbacks: fb ? fb === "1" || fb.toLowerCase() === "true" : !baseURL,
  };
}

export type AssistantStatus = {
  available: boolean;
  mode: AssistantMode;
  /** Why it isn't available, in plain words for the panel. */
  reason: string | null;
  model: string;
  endpoint: string;
};

/** Whether the assistant may run right now. In demo mode it refuses as soon as real data is loaded. */
export function assistantStatus(db: DatabaseSync): AssistantStatus {
  const cfg = assistantConfig();
  const base = { mode: cfg.mode, model: cfg.model, endpoint: cfg.baseURL ?? "Anthropic API (default)" };
  if (cfg.mode === "off") {
    return {
      ...base,
      available: false,
      reason:
        "The assistant is turned off. To try it on the demo data, set ASSISTANT_ENABLED=demo and an API key in .env.local, then restart the app.",
    };
  }
  if (cfg.mode === "demo") {
    const real = db.prepare("SELECT COUNT(*) AS n FROM issues WHERE source != 'demo'").get() as { n: number };
    if (real.n > 0) {
      return {
        ...base,
        available: false,
        reason:
          "The assistant is in demo-only mode and real data is loaded, so it's paused: questions would send real program data to the AI endpoint. Load the demo data to try it, or set ASSISTANT_ENABLED=on once an approved endpoint is configured.",
      };
    }
  }
  return { ...base, available: true, reason: null };
}
