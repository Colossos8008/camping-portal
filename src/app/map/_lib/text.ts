const REPLACEMENTS: Array<[string, string]> = [
  ["Ã„", "Ä"],
  ["Ã–", "Ö"],
  ["Ãœ", "Ü"],
  ["Ã¤", "ä"],
  ["Ã¶", "ö"],
  ["Ã¼", "ü"],
  ["ÃŸ", "ß"],
  ["Â·", "·"],
  ["Â", ""],
  ["â€¦", "…"],
  ["â€ž", "„"],
  ["â€œ", "“"],
  ["â€š", "‚"],
  ["â€˜", "‘"],
  ["â€", "”"],
  ["â€“", "-"],
  ["â€”", "-"],
  ["â€¹", "‹"],
  ["â€º", "›"],
];

export function normalizeDisplayText(value: unknown): string {
  const source = typeof value === "string" ? value : value == null ? "" : String(value);
  return REPLACEMENTS.reduce((current, [search, replacement]) => current.split(search).join(replacement), source);
}
