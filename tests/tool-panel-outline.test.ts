import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { normalizeToolDisplayConfig } from "../src/config-store.ts";
import {
  frameToolPanelLines,
  patchToolExecutionPrototype,
  resolveOutlineDefinition,
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

const fakeApi = {
  decorateTool: (tool: Record<string, unknown>) => ({ ...tool, renderShell: "default", renderResult: "decorated" }),
};

test("resolveOutlineDefinition reroutes a stock self-framed edit", () => {
  const stockEdit = { name: "edit", renderShell: "self", renderResult: "stock" };
  const resolved = resolveOutlineDefinition(stockEdit, fakeApi);
  assert.equal(resolved?.renderShell, "default");
  assert.equal(resolved?.renderResult, "decorated");
  assert.equal(resolveOutlineDefinition(stockEdit, fakeApi), resolved, "decoration is cached");
});

test("resolveOutlineDefinition leaves other definitions alone", () => {
  const bash = { name: "bash", renderShell: "self" };
  const decoratedEdit = { name: "edit", renderShell: "default" };
  assert.equal(resolveOutlineDefinition(bash, fakeApi), bash);
  assert.equal(resolveOutlineDefinition(decoratedEdit, fakeApi), decoratedEdit);
  const stockEdit = { name: "edit", renderShell: "self" };
  assert.equal(resolveOutlineDefinition(stockEdit, undefined), stockEdit);
});

test("patched getRenderShell frames a stock edit only while outline is enabled", () => {
  const key = Symbol.for("pi-tool-display.api.v1");
  const globals = globalThis as Record<symbol, unknown>;
  const previousApi = globals[key];
  globals[key] = fakeApi;
  try {
    const prototype = createPrototype();
    (prototype as unknown as Record<string, unknown>).getRenderShell = function (this: { toolDefinition?: { renderShell?: string } }) {
      return this.toolDefinition?.renderShell ?? "default";
    };
    let enabled = true;
    patchToolExecutionPrototype(prototype, () => tagTheme, () => enabled);
    const component = createComponent(prototype) as unknown as { toolDefinition: unknown; getRenderShell(): string };
    delete (component as Record<string, unknown>).getRenderShell;
    component.toolDefinition = { name: "edit", renderShell: "self" };

    assert.equal(component.getRenderShell(), "default");
    enabled = false;
    assert.equal(component.getRenderShell(), "self");

    restoreToolExecutionPrototype(prototype);
    enabled = true;
    assert.equal(component.getRenderShell(), "self");
  } finally {
    globals[key] = previousApi;
  }
});

test("patched render passes tool name and state to the border slot resolver", () => {
  const prototype = createPrototype();
  const seen: Array<[string | undefined, string]> = [];
  patchToolExecutionPrototype(prototype, () => tagTheme, () => true, (toolName, state) => {
    seen.push([toolName, state]);
    return toolName === "edit" && state === "success" ? "diffBorder" : undefined;
  });

  const edit = createComponent(prototype) as ReturnType<typeof createComponent> & { toolName: string };
  edit.toolName = "edit";
  assert.ok(edit.render(20)[1]?.startsWith("<diffBorder>"));

  const bash = createComponent(prototype) as ReturnType<typeof createComponent> & { toolName: string };
  bash.toolName = "bash";
  assert.ok(bash.render(20)[1]?.startsWith("<success>"));

  const failedEdit = createComponent(prototype, { result: { isError: true } }) as ReturnType<typeof createComponent> & { toolName: string };
  failedEdit.toolName = "edit";
  assert.ok(failedEdit.render(20)[1]?.startsWith("<error>"));

  assert.deepEqual(seen, [["edit", "success"], ["bash", "success"], ["edit", "error"]]);
});

test("patched render draws a hex border color without consulting the theme", () => {
  const prototype = createPrototype();
  patchToolExecutionPrototype(prototype, () => tagTheme, () => true, () => "#ff8a3d");
  const edit = createComponent(prototype) as ReturnType<typeof createComponent> & { toolName: string };
  edit.toolName = "edit";
  assert.ok(edit.render(20)[1]?.startsWith("\x1b[38;2;255;138;61m"));
});
