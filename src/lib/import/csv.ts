export type CsvRow = Record<string, string>;

function normalizeHeader(h: string): string {
  return h.trim();
}

// Minimal CSV parser with quote support.
// - comma separated
// - double quotes to wrap fields
// - doubled quotes inside quoted fields ("") -> "
export function parseCsv(text: string): CsvRow[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    // ignore comment lines starting with '#'
    .filter((l) => !l.trimStart().startsWith("#"));

  if (lines.length === 0) return [];

  const header = splitCsvLine(lines[0]).map(normalizeHeader);
  const rows: CsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const row: CsvRow = {};
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = (cols[c] ?? "").trim();
    }
    rows.push(row);
  }

  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }

  out.push(cur);
  return out;
}
