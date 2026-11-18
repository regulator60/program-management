import type { DatabaseSync } from "node:sqlite";
import { getConfig } from "../config";

/**
 * The assistant is OFF unless turned on in Settings → Assistant, or with
 * ASSISTANT_ENABLED in .env.local (Settings wins when set):
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

const envMode = (): AssistantMode => {
  const raw = (process.env.ASSISTANT_ENABLED ?? "").trim().toLowerCase();
  return ["1", "true", "on", "yes"].includes(raw) ? "on" : raw === "demo" ? "demo" : "off";
};

/**
 * Effective assistant settings: Settings → Assistant wins where it's set,
 * otherwise the environment variables. The API key always comes from the
 * environment (ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN, or an `ant auth login` profile).
 */
export function assistantConfig(db: DatabaseSync) {
  const s = getConfig(db).assistant;
  const mode: AssistantMode = s.mode || envMode();
  const baseURL = s.baseUrl.trim() || process.env.ANTHROPIC_BASE_URL?.trim() || null;
  const envEffort = (process.env.ASSISTANT_EFFORT ?? "").trim().toLowerCase();
  const effort = s.effort || (["low", "medium", "high"].includes(envEffort) ? envEffort : "medium");
  const fbEnv = process.env.ASSISTANT_REFUSAL_FALLBACK?.trim();
  const fallbacks =
    s.refusalFallback === "on"
      ? true
      : s.refusalFallback === "off"
        ? false
        : fbEnv
          ? fbEnv === "1" || fbEnv.toLowerCase() === "true"
          : !baseURL;
  return {
    mode,
    /** Where the mode came from, for the Settings page. */
    modeSource: (s.mode ? "settings" : process.env.ASSISTANT_ENABLED ? "environment" : "default") as "settings" | "environment" | "default",
    model: s.model.trim() || process.env.ASSISTANT_MODEL?.trim() || "claude-opus-5-5",
    effort: effort as "low" | "medium" | "high",
    baseURL,
    /** Only a base URL set in Settings is passed explicitly; otherwise the SDK reads ANTHROPIC_BASE_URL itself. */
    baseURLFromSettings: s.baseUrl.trim() || null,
    fallbacks,
    hasKey: !!(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim()),
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
  const cfg = assistantConfig(db);
  const base = { mode: cfg.mode, model: cfg.model, endpoint: cfg.baseURL ?? "Anthropic API (default)" };
  if (cfg.mode === "off") {
    return {
      ...base,
      available: false,
      reason: "The assistant is turned off. Turn it on in Settings → Assistant (demo data only is the safe way to try it).",
    };
  }
  if (cfg.mode === "on" && cfg.modeSource === "settings" && !getConfig(db).assistant.approvedForRealData) {
    return {
      ...base,
      available: false,
      reason: "The assistant is set to work with real data, but the endpoint hasn't been confirmed as approved. Confirm it in Settings → Assistant.",
    };
  }
  if (cfg.mode === "demo") {
    const real = db.prepare("SELECT COUNT(*) AS n FROM issues WHERE source != 'demo'").get() as { n: number };
    if (real.n > 0) {
      return {
        ...base,
        available: false,
        reason:
          "The assistant is set to demo data only and real data is loaded, so it's paused: questions would send real program data to the AI endpoint. Load the demo data to try it, or switch it on for real data in Settings → Assistant once the endpoint is approved.",
      };
    }
  }
  return { ...base, available: true, reason: null };
}
