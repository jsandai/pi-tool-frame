import {
  type ExtensionAPI,
  ToolExecutionComponent,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { onReloadShutdown } from "./extension-lifecycle.js";
import { colorForeground } from "./theme-color.js";
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
  toolName?: string;
  toolDefinition?: ToolDefinitionLike;
  hasRendererDefinition?(): boolean;
  getRenderShell?(): string;
}

interface ToolDefinitionLike {
  name?: string;
  renderShell?: string;
  renderCall?: unknown;
  renderResult?: unknown;
}

interface ToolDisplayApiLike {
  decorateTool(tool: ToolDefinitionLike, adapter?: Record<string, unknown>): ToolDefinitionLike;
}

type DefinitionGetter = (this: ToolExecutionInternals) => unknown;

export interface PatchableToolExecutionPrototype {
  render: RenderFn;
  updateDisplay: UpdateDisplayFn;
  getRenderShell?: DefinitionGetter;
  getCallRenderer?: DefinitionGetter;
  getResultRenderer?: DefinitionGetter;
  __piToolPanelOriginalRender?: RenderFn;
  __piToolPanelOriginalUpdateDisplay?: UpdateDisplayFn;
  __piToolPanelOriginalGetters?: Partial<Record<DefinitionGetterName, DefinitionGetter>>;
}

type DefinitionGetterName = "getRenderShell" | "getCallRenderer" | "getResultRenderer";

const TOOL_DISPLAY_API_KEY = Symbol.for("pi-tool-display.api.v1");
const DIFF_TOOL_NAMES = new Set(["edit", "write"]);
const decoratedDefinitions = new WeakMap<ToolDefinitionLike, ToolDefinitionLike>();

/**
 * Another extension can re-register pi's stock edit tool after this package
 * registered its own (the Antigravity bridge's approval shadows do), and the
 * stock edit draws a self-framed filled panel. In outline mode, render such a
 * definition through this package's edit renderers so it gets the shared frame.
 */
export function resolveOutlineDefinition(
  definition: ToolDefinitionLike | undefined,
  api: ToolDisplayApiLike | undefined,
): ToolDefinitionLike | undefined {
  if (!definition || !api || definition.name !== "edit" || definition.renderShell !== "self") {
    return definition;
  }
  let decorated = decoratedDefinitions.get(definition);
  if (!decorated) {
    try {
      decorated = api.decorateTool({ ...definition }, { kind: "edit", overrideExistingRenderers: true });
    } catch {
      return definition;
    }
    decoratedDefinitions.set(definition, decorated);
  }
  return decorated;
}

function getToolDisplayApi(): ToolDisplayApiLike | undefined {
  const api = (globalThis as Record<symbol, unknown>)[TOOL_DISPLAY_API_KEY] as ToolDisplayApiLike | undefined;
  return typeof api?.decorateTool === "function" ? api : undefined;
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
  getBorderSlot?: (toolName: string | undefined, state: ToolPanelState) => string | undefined,
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

  // Read at construction too, so a stock edit gets the framed default shell
  // from the start instead of the self-render container.
  const originalGetters: Partial<Record<DefinitionGetterName, DefinitionGetter>> = {};
  const effectiveDefinition = (component: ToolExecutionInternals): ToolDefinitionLike | undefined =>
    isEnabled() ? resolveOutlineDefinition(component.toolDefinition, getToolDisplayApi()) : component.toolDefinition;
  const readers: Record<DefinitionGetterName, (definition: ToolDefinitionLike | undefined) => unknown> = {
    getRenderShell: (definition) => definition?.renderShell ?? "default",
    getCallRenderer: (definition) => definition?.renderCall,
    getResultRenderer: (definition) => definition?.renderResult,
  };
  for (const name of Object.keys(readers) as DefinitionGetterName[]) {
    const original = prototype[name];
    if (typeof original !== "function") {
      continue;
    }
    originalGetters[name] = original;
    prototype[name] = function patchedDefinitionGetter(this: ToolExecutionInternals): unknown {
      const definition = effectiveDefinition(this);
      return definition === this.toolDefinition ? original.call(this) : readers[name](definition);
    };
  }
  prototype.__piToolPanelOriginalGetters = originalGetters;

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
    const state = resolveToolPanelState(this);
    const color = STATE_COLORS[state];
    const borderSlot = getBorderSlot?.(this.toolName, state);
    const colorBorder = (text: string): string => {
      // A configured border color (a theme token or "#rrggbb") wins over the
      // state color; tokens unknown to the theme fall back to the state color.
      if (borderSlot) {
        try {
          const themed = colorForeground(theme, borderSlot, text);
          if (themed !== text) {
            return themed;
          }
        } catch {
          // slot unknown to this theme
        }
      }
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
  for (const [name, original] of Object.entries(prototype.__piToolPanelOriginalGetters ?? {})) {
    prototype[name as DefinitionGetterName] = original;
  }
  delete prototype.__piToolPanelOriginalRender;
  delete prototype.__piToolPanelOriginalUpdateDisplay;
  delete prototype.__piToolPanelOriginalGetters;
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
  const getBorderSlot = (toolName: string | undefined, state: ToolPanelState): string | undefined => {
    const config = getConfig();
    // Diff panels only take their own color once finished, so a failed edit
    // still reads as an error and a running one as pending.
    if (state === "success" && toolName !== undefined && DIFF_TOOL_NAMES.has(toolName) && config.diffPanelBorderColor) {
      return config.diffPanelBorderColor;
    }
    return config.toolPanelBorderColor;
  };

  patchToolExecutionPrototype(getToolExecutionPrototype(), getTheme, isEnabled, getBorderSlot);

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
