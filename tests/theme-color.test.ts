import assert from "node:assert/strict";
import test from "node:test";
import { colorForeground, type ForegroundTheme } from "../src/theme-color.ts";

const tagTheme: ForegroundTheme = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
};

test("colorForeground renders #rrggbb as a truecolor foreground", () => {
  assert.equal(colorForeground(tagTheme, "#ff8a3d", "x"), "\x1b[38;2;255;138;61mx\x1b[39m");
});

test("colorForeground expands #rgb shorthand", () => {
  assert.equal(colorForeground(tagTheme, "#0fA", "x"), "\x1b[38;2;0;255;170mx\x1b[39m");
});

test("colorForeground passes tokens and malformed hex to the theme", () => {
  assert.equal(colorForeground(tagTheme, "accent", "x"), "<accent>x</accent>");
  assert.equal(colorForeground(tagTheme, "#ff8a3", "x"), "<#ff8a3>x</#ff8a3>");
});
