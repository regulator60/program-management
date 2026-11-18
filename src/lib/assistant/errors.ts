import Anthropic from "@anthropic-ai/sdk";

/** Errors in words the user can act on. */
export function describeAssistantError(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return "The AI endpoint rejected the credentials. Check ANTHROPIC_API_KEY in .env.local, and the endpoint in Settings → Assistant.";
  }
  if (e instanceof Anthropic.NotFoundError) return "The AI endpoint doesn't know that model. Check the model in Settings → Assistant.";
  if (e instanceof Anthropic.RateLimitError) return "The AI endpoint is rate limiting requests. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `The AI endpoint rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return "Couldn't reach the AI endpoint. Check your network and the endpoint in Settings → Assistant.";
  if (e instanceof Anthropic.APIError) return `The AI endpoint returned an error (${e.status ?? "no status"}). Try again.`;
  if (e instanceof Error && /api key|apiKey|authToken|credentials/i.test(e.message)) {
    return "No API key is set. Add ANTHROPIC_API_KEY to .env.local and restart the app.";
  }
  return e instanceof Error ? e.message : String(e);
}
