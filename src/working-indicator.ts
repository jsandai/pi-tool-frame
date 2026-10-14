import type {
  ExtensionAPI,
  ExtensionContext,
  WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";
import { colorForeground } from "./theme-color.js";
import type { ToolDisplayConfig } from "./types.js";

export interface WorkingIndicatorTheme {
  fg(color: string, text: string): string;
}

// Same frames and cadence as pi's default Loader; only the color differs.
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

/**
 * Build spinner frames in the given theme color token or "#rrggbb" value, or
 * undefined when the theme does not define the token so pi falls back to its
 * accent spinner.
 */
export function buildWorkingIndicator(
  theme: WorkingIndicatorTheme,
  color: string,
): WorkingIndicatorOptions | undefined {
  try {
    return {
      frames: SPINNER_FRAMES.map((frame) => colorForeground(theme, color, frame)),
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
    // Older pi builds and some non-TUI hosts have no working-indicator API.
    if (typeof ctx.ui.setWorkingIndicator !== "function") {
      return;
    }
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
