import {
  type ExtensionAPI,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { onReloadShutdown } from "./extension-lifecycle.js";
import type { ToolDisplayConfig } from "./types.js";

export interface ToolPanelOutlineTheme {
  fg(color: string, text: string): string;
}

export type ToolPanelState = "pending" | "success" | "error";

type RenderFn = (width: number) => string[];
type UpdateDisplayFn = () => void;

interface BgSettable {
  setBgFn?(fn: (text: string) => string): void;
  setCustomBgFn?(fn: (text: string) => string): void;
}

interface ToolExecutionInternals {
  contentBox?: BgSettable;
  contentText?: BgSettable;
  imageComponents?: unknown[];
  hideComponent?: boolean;
  isPartial?: boolean;
  result?: { isError?: boolean };
  hasRendererDefinition?(): boolean;
  getRenderShell?(): string;
}

export interface PatchableToolExecutionPrototype {
  render: RenderFn;
  updateDisplay: UpdateDisplayFn;
  __piToolPanelOriginalRender?: RenderFn;
  __piToolPanelOriginalUpdateDisplay?: UpdateDisplayFn;
}

const STATE_COLORS: Record<ToolPanelState, string> = {
  pending: "accent",
  success: "success",
  error: "error",
};

// Below this the frame would eat most of the row; fall back to the native fill.
const MIN_OUTLINE_WIDTH = 12;
const RESET = "\x1b[0m";
const NO_BACKGROUND = (text: string): string => text;

export function resolveToolPanelState(component: ToolExecutionInternals): ToolPanelState {
  if (component.isPartial) {
    return "pending";
  }
  return component.result?.isError ? "error" : "success";
}

function isBlankLine(line: string): boolean {
  return visibleWidth(line) === 0 || line.replace(/\x1b\[[0-9;:]*m/g, "").trim() === "";
}

/**
 * Wraps panel body lines (rendered at width - 2) in a rounded frame.
 * The body's blank top/bottom padding rows are replaced by the border rows,
 * so the panel keeps its height and mouse regions stay row-aligned.
 */
export function frameToolPanelLines(
  bodyLines: string[],
  totalWidth: number,
  colorBorder: (text: string) => string,
): string[] {
  const innerWidth = Math.max(0, totalWidth - 2);
  const body = [...bodyLines];
  if (body.length > 0 && isBlankLine(body[0] ?? "")) {
    body.shift();
  }
  if (body.length > 0 && isBlankLine(body[body.length - 1] ?? "")) {
    body.pop();
  }

  const framed = [colorBorder(`╭${"─".repeat(innerWidth)}╮`)];
  for (const line of body) {
    const content = truncateToWidth(line, innerWidth, "");
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(content)));
    framed.push(`${colorBorder("│")}${content}${RESET}${padding}${colorBorder("│")}`);
  }
  framed.push(colorBorder(`╰${"─".repeat(innerWidth)}╯`));
  return framed;
}

function canOutline(component: ToolExecutionInternals, width: number): boolean {
  if (width < MIN_OUTLINE_WIDTH || component.hideComponent) {
    return false;
  }
  // Inline images use terminal graphics escapes that a frame column would corrupt.
  if ((component.imageComponents?.length ?? 0) > 0) {
    return false;
  }
  // Tools with a "self" render shell draw their own framing.
  if (component.hasRendererDefinition?.() && component.getRenderShell?.() === "self") {
    return false;
  }
  return true;
}

export function patchToolExecutionPrototype(
  prototype: PatchableToolExecutionPrototype,
  getTheme: () => ToolPanelOutlineTheme | undefined,
  isEnabled: () => boolean,
): void {
  if (prototype.__piToolPanelOriginalRender) {
    return;
  }
  if (typeof prototype.render !== "function" || typeof prototype.updateDisplay !== "function") {
    return;
  }

  const originalRender = prototype.render;
  const originalUpdateDisplay = prototype.updateDisplay;
  prototype.__piToolPanelOriginalRender = originalRender;
  prototype.__piToolPanelOriginalUpdateDisplay = originalUpdateDisplay;

  prototype.updateDisplay = function patchedUpdateDisplay(this: ToolExecutionInternals): void {
    originalUpdateDisplay.call(this);
    if (!isEnabled() || !getTheme()) {
      return;
    }
    this.contentBox?.setBgFn?.(NO_BACKGROUND);
    this.contentText?.setCustomBgFn?.(NO_BACKGROUND);
  };

  prototype.render = function patchedRender(this: ToolExecutionInternals, width: number): string[] {
    const theme = getTheme();
    if (!isEnabled() || !theme || !canOutline(this, width)) {
      return originalRender.call(this, width);
    }

    const lines = originalRender.call(this, width - 2);
    if (lines.length < 2) {
      return lines;
    }

    // The first row is the component's leading Spacer; keep it outside the frame.
    const [spacer, ...body] = lines;
    const color = STATE_COLORS[resolveToolPanelState(this)];
    const colorBorder = (text: string): string => {
      try {
        return theme.fg(color, text);
      } catch {
        return text;
      }
    };
    return [spacer ?? "", ...frameToolPanelLines(body, width, colorBorder)];
  };
}

export function restoreToolExecutionPrototype(prototype: PatchableToolExecutionPrototype): void {
  if (prototype.__piToolPanelOriginalRender) {
    prototype.render = prototype.__piToolPanelOriginalRender;
  }
  if (prototype.__piToolPanelOriginalUpdateDisplay) {
    prototype.updateDisplay = prototype.__piToolPanelOriginalUpdateDisplay;
  }
  delete prototype.__piToolPanelOriginalRender;
  delete prototype.__piToolPanelOriginalUpdateDisplay;
}

const registeredApis = new WeakSet<ExtensionAPI>();

function getToolExecutionPrototype(): PatchableToolExecutionPrototype {
  return ToolExecutionComponent.prototype as unknown as PatchableToolExecutionPrototype;
}

export default function registerToolPanelOutline(
  pi: ExtensionAPI,
  getConfig: () => ToolDisplayConfig,
): void {
  if (registeredApis.has(pi)) {
    return;
  }
  registeredApis.add(pi);

  let activeTheme: ToolPanelOutlineTheme | undefined;
  const getTheme = (): ToolPanelOutlineTheme | undefined => activeTheme;
  const isEnabled = (): boolean => getConfig().toolPanelStyle === "outline";

  patchToolExecutionPrototype(getToolExecutionPrototype(), getTheme, isEnabled);

  onReloadShutdown(pi, () => {
    restoreToolExecutionPrototype(getToolExecutionPrototype());
    activeTheme = undefined;
    registeredApis.delete(pi);
  });

  pi.on("session_start", async (_event, ctx) => {
    activeTheme = ctx?.ui?.theme as unknown as ToolPanelOutlineTheme;
    patchToolExecutionPrototype(getToolExecutionPrototype(), getTheme, isEnabled);
  });
}
