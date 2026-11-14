/**
 * Base path the app is served under. Empty locally; "/program-management" for
 * the GitHub Pages demo. next/link adds it automatically; plain <a href> and
 * SVG links must use withBase().
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function withBase(path: string) {
  return `${BASE_PATH}${path}`;
}

export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";
