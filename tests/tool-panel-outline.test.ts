import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { normalizeToolDisplayConfig } from "../src/config-store.ts";
import {
  frameToolPanelLines,
  patchToolExecutionPrototype,
  resolveToolPanelState,
  restoreToolExecutionPrototype,
  type PatchableToolExecutionPrototype,
  type ToolPanelOutlineTheme,
} from "../src/tool-panel-outline.ts";

const plainBorder = (text: string): string => text;

const tagTheme: ToolPanelOutlineTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
};

interface FakeComponent {
  isPartial: boolean;
  result?: { isError?: boolean };
  imageComponents: unknown[];
  hideComponent: boolean;
  bgCalls: string[];
  contentBox: { setBgFn(fn: (text: string) => string): void };
  contentText: { setCustomBgFn(fn: (text: string) => string): void };
  hasRendererDefinition(): boolean;
  getRenderShell(): string;
}

function createPrototype(): PatchableToolExecutionPrototype {
  return {
    render(this: FakeComponent, width: number): string[] {
      return ["", " ".repeat(width), `body@${width}`, " ".repeat(width)];
    },
    updateDisplay(this: FakeComponent): void {
      this.bgCalls.push("native");
    },
  } as PatchableToolExecutionPrototype;
}

function createComponent(
  prototype: PatchableToolExecutionPrototype,
  overrides: Partial<FakeComponent> = {},
): FakeComponent & PatchableToolExecutionPrototype {
  const component = Object.create(prototype) as FakeComponent & PatchableToolExecutionPrototype;
  component.isPartial = false;
  component.imageComponents = [];
  component.hideComponent = false;
  component.bgCalls = [];
  component.contentBox = { setBgFn: () => component.bgCalls.push("box-cleared") };
  component.contentText = { setCustomBgFn: () => component.bgCalls.push("text-cleared") };
  component.hasRendererDefinition = () => true;
  component.getRenderShell = () => "default";
  Object.assign(component, overrides);
  return component;
}

test("frameToolPanelLines replaces padding rows with border rows", () => {
  const framed = frameToolPanelLines(["", "hello", ""], 12, plainBorder);
  assert.deepEqual(framed, [
    "╭──────────╮",
    "│hello\x1b[0m     │",
    "╰──────────╯",
  ]);
});

test("frameToolPanelLines keeps every row at the requested width", () => {
  const framed = frameToolPanelLines(["", "x".repeat(40), "short", ""], 20, plainBorder);
  for (const line of framed) {
    assert.equal(visibleWidth(line), 20);
  }
});

test("resolveToolPanelState maps partial, error and success", () => {
  assert.equal(resolveToolPanelState({ isPartial: true }), "pending");
  assert.equal(resolveToolPanelState({ isPartial: false, result: { isError: true } }), "error");
  assert.equal(resolveToolPanelState({ isPartial: false, result: {} }), "success");
});

test("patched render frames the panel in the state color", () => {
  const prototype = createPrototype();
  patchToolExecutionPrototype(prototype, () => tagTheme, () => true);
  const component = createComponent(prototype, { result: { isError: true } });

  const lines = component.render(20);

  assert.equal(lines[0], "");
  assert.ok(lines[1]?.startsWith("<error>╭"));
  assert.ok(lines[2]?.includes("body@18"));
  assert.ok(lines[3]?.startsWith("<error>╰"));
  assert.equal(lines.length, 4);
});

test("patched updateDisplay clears native fills only when enabled", () => {
  const prototype = createPrototype();
  let enabled = false;
  patchToolExecutionPrototype(prototype, () => tagTheme, () => enabled);

  const disabled = createComponent(prototype);
  disabled.updateDisplay();
  assert.deepEqual(disabled.bgCalls, ["native"]);

  enabled = true;
  const active = createComponent(prototype);
  active.updateDisplay();
  assert.deepEqual(active.bgCalls, ["native", "box-cleared", "text-cleared"]);
});

test("patched render falls back for images, self shells and narrow widths", () => {
  const prototype = createPrototype();
  patchToolExecutionPrototype(prototype, () => tagTheme, () => true);

  const withImage = createComponent(prototype, { imageComponents: [{}] });
  assert.equal(withImage.render(40)[2], "body@40");

  const selfShell = createComponent(prototype, { getRenderShell: () => "self" });
  assert.equal(selfShell.render(40)[2], "body@40");

  const narrow = createComponent(prototype);
  assert.equal(narrow.render(8)[2], "body@8");
});

test("patched render is a passthrough without a theme", () => {
  const prototype = createPrototype();
  patchToolExecutionPrototype(prototype, () => undefined, () => true);
  assert.equal(createComponent(prototype).render(40)[2], "body@40");
});

test("restoreToolExecutionPrototype puts the native methods back", () => {
  const prototype = createPrototype();
  const { render, updateDisplay } = prototype;
  patchToolExecutionPrototype(prototype, () => tagTheme, () => true);
  assert.notEqual(prototype.render, render);

  restoreToolExecutionPrototype(prototype);

  assert.equal(prototype.render, render);
  assert.equal(prototype.updateDisplay, updateDisplay);
  assert.equal(prototype.__piToolPanelOriginalRender, undefined);
});

test("toolPanelStyle normalizes unknown values to filled", () => {
  assert.equal(normalizeToolDisplayConfig({}).toolPanelStyle, "filled");
  assert.equal(normalizeToolDisplayConfig({ toolPanelStyle: "outline" }).toolPanelStyle, "outline");
  assert.equal(normalizeToolDisplayConfig({ toolPanelStyle: "neon" }).toolPanelStyle, "filled");
});
