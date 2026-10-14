import assert from "node:assert/strict";
import test from "node:test";
import { normalizeToolDisplayConfig } from "../src/config-store.ts";
import { DEFAULT_TOOL_DISPLAY_CONFIG, type ToolDisplayConfig } from "../src/types.ts";
import registerWorkingIndicator, {
  buildWorkingIndicator,
  type WorkingIndicatorTheme,
} from "../src/working-indicator.ts";

const tagTheme: WorkingIndicatorTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
};

const strictTheme = (known: string[]): WorkingIndicatorTheme => ({
  fg: (color, text) => {
    if (!known.includes(color)) {
      throw new Error(`Unknown theme color: ${color}`);
    }
    return `<${color}>${text}</${color}>`;
  },
});

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

function createHarness(config: () => ToolDisplayConfig, theme: WorkingIndicatorTheme) {
  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  };
  const calls: unknown[] = [];
  const ctx = { ui: { theme, setWorkingIndicator: (options: unknown) => calls.push(options) } };
  registerWorkingIndicator(pi as never, config);
  const emit = async (event: string) => {
    for (const handler of handlers.get(event) ?? []) {
      await handler({}, ctx);
    }
  };
  return { calls, emit };
}

test("buildWorkingIndicator colors every default frame with the token", () => {
  const indicator = buildWorkingIndicator(tagTheme, "spinner");
  assert.equal(indicator?.frames.length, 10);
  assert.equal(indicator?.frames[0], "<spinner>⠋</spinner>");
  assert.equal(indicator?.intervalMs, 80);
});

test("buildWorkingIndicator falls back to pi's default for an unknown token", () => {
  assert.equal(buildWorkingIndicator(strictTheme(["accent"]), "spinner"), undefined);
});

test("buildWorkingIndicator accepts a hex color the theme has no token for", () => {
  const indicator = buildWorkingIndicator(strictTheme(["accent"]), "#03edf9");
  assert.equal(indicator?.frames[0], "\x1b[38;2;3;237;249m⠋\x1b[39m");
});

test("normalizeToolDisplayConfig keeps workingIndicatorColor and drops blanks", () => {
  assert.equal(normalizeToolDisplayConfig({ workingIndicatorColor: "spinner" }).workingIndicatorColor, "spinner");
  assert.equal(normalizeToolDisplayConfig({ workingIndicatorColor: "  " }).workingIndicatorColor, undefined);
  assert.equal(normalizeToolDisplayConfig({}).workingIndicatorColor, undefined);
});

test("unset option never touches the indicator", async () => {
  const { calls, emit } = createHarness(() => DEFAULT_TOOL_DISPLAY_CONFIG, tagTheme);
  await emit("session_start");
  await emit("agent_start");
  assert.deepEqual(calls, []);
});

test("hosts without setWorkingIndicator are skipped without throwing", async () => {
  const handlers: Handler[] = [];
  const pi = { on: (_event: string, handler: Handler) => handlers.push(handler) };
  registerWorkingIndicator(pi as never, () => ({ ...DEFAULT_TOOL_DISPLAY_CONFIG, workingIndicatorColor: "spinner" }));
  for (const handler of handlers) {
    await handler({}, { ui: { theme: tagTheme } });
  }
});

test("set option applies on session start and every run, and resets once cleared", async () => {
  let config: ToolDisplayConfig = { ...DEFAULT_TOOL_DISPLAY_CONFIG, workingIndicatorColor: "spinner" };
  const { calls, emit } = createHarness(() => config, tagTheme);
  await emit("session_start");
  await emit("agent_start");
  assert.equal(calls.length, 2);
  assert.equal((calls[1] as { frames: string[] }).frames[0], "<spinner>⠋</spinner>");

  config = DEFAULT_TOOL_DISPLAY_CONFIG;
  await emit("agent_start");
  await emit("agent_start");
  assert.deepEqual(calls.slice(2), [undefined]);
});
