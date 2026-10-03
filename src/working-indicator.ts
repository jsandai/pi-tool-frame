import type {
  ExtensionAPI,
  ExtensionContext,
  WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import type { ToolDisplayConfig } from "./types.js";

export interface WorkingIndicatorTheme {
  fg(color: string, text: string): string;
}

// Same frames and cadence as pi's default Loader; only the color differs.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/**
 * Build spinner frames in the given theme color token, or undefined when the
 * theme does not define it so pi falls back to its accent spinner. Themes may
 * carry extra color keys beyond pi's schema, which is how a theme opts in.
 */
export function buildWorkingIndicator(
  theme: WorkingIndicatorTheme,
  color: string,
): WorkingIndicatorOptions | undefined {
  try {
    return {
      frames: SPINNER_FRAMES.map((frame) => theme.fg(color, frame)),
      intervalMs: SPINNER_INTERVAL_MS,
    };
  } catch {
    return undefined;
  }
}

const registeredApis = new WeakSet<ExtensionAPI>();

export default function registerWorkingIndicator(
  pi: ExtensionAPI,
  getConfig: () => ToolDisplayConfig,
): void {
  if (registeredApis.has(pi)) {
    return;
  }
  registeredApis.add(pi);

  // Only reset the indicator if this module set it, so an unset option never
  // clobbers another extension's custom indicator.
  let applied = false;

  const apply = (ctx: ExtensionContext): void => {
    const color = getConfig().workingIndicatorColor;
    if (!color) {
      if (applied) {
        ctx.ui.setWorkingIndicator(undefined);
        applied = false;
      }
      return;
    }
    ctx.ui.setWorkingIndicator(buildWorkingIndicator(ctx.ui.theme, color));
    applied = true;
  };

  pi.on("session_start", async (_event, ctx) => apply(ctx));
  // Frames carry baked ANSI colors and pi hot-reloads an edited user theme
  // mid-session, so rebuild them at the start of every run.
  pi.on("agent_start", async (_event, ctx) => apply(ctx));
}
