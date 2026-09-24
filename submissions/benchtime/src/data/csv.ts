// RFC 4180 CSV reader. PUCAR's roster keeps the last hearing summary as a multi-line quoted cell, so a
// line-by-line split would cut cases in half; this is a small state machine over characters instead.

/** Split CSV text into rows of raw cells. Records the 1-based line on which each row starts (for errors). */
export function parseCsvRows(text: string): { cells: string[]; line: number }[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // byte-order mark from spreadsheet exports
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let quotedCell = false; // the current cell was quoted, so an empty value still counts as a cell
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (c === "\n") line++;
        // CRLF inside a quoted cell is normalised to LF so notes compare equal across exports
        if (c === "\r" && text[i + 1] === "\n") continue;
        cell += c;
      }
      continue;
    }
    if (c === '"') {
      if (cell.length > 0) throw new Error(`CSV line ${line}: stray quote inside an unquoted field`);
      inQuotes = true;
      quotedCell = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      quotedCell = false;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      // a blank line (one empty unquoted cell) is skipped, not a one-column row
      if (!(row.length === 1 && row[0] === "" && !quotedCell)) rows.push({ cells: row, line: rowLine });
      row = [];
      cell = "";
      quotedCell = false;
      line++;
      rowLine = line;
    } else {
      cell += c;
    }
  }
  if (inQuotes) throw new Error(`CSV line ${rowLine}: quoted field is never closed`);
  if (cell.length > 0 || row.length > 0 || quotedCell) {
    row.push(cell);
    rows.push({ cells: row, line: rowLine });
  }
  return rows;
}

/**
 * Parse CSV text with a header row into records keyed by the (trimmed) header names. Handles quoted
 * fields, doubled quotes, newlines inside quotes, CRLF and a BOM. A row with a different number of
 * cells than the header is an error naming its line: silently padding would shift every later column.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseCsvRows(text);
  const head = rows[0];
  if (!head) return [];
  const headers = head.cells.map((h) => h.trim());
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) throw new Error(`CSV line ${head.line}: duplicate header "${h}"`);
    seen.add(h);
  }
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const { cells, line } = rows[r]!;
    if (cells.length !== headers.length) {
      throw new Error(`CSV line ${line}: expected ${headers.length} fields, found ${cells.length}`);
    }
    const rec: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) rec[headers[i]!] = cells[i]!;
    out.push(rec);
  }
  return out;
}
