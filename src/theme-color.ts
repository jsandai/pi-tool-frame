export interface ForegroundTheme {
  fg(color: string, text: string): string;
}

const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function parseHexColor(color: string): [number, number, number] | undefined {
  const match = HEX_COLOR_PATTERN.exec(color.trim());
  if (!match) {
    return undefined;
  }
  const digits = match[1]!;
  const full = digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits;
  return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * Color text from a theme token or a literal "#rgb"/"#rrggbb" value. pi 1.2
 * validates themes against a closed schema, so a theme can no longer carry
 * extra color keys; a hex value lets config pick a color the schema has no
 * slot for. Throws like theme.fg when a token is unknown to the theme.
 */
export function colorForeground(theme: ForegroundTheme, color: string, text: string): string {
  const rgb = parseHexColor(color);
  if (!rgb) {
    return theme.fg(color, text);
  }
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m`;
}
