/** Minimal RFC 4180 reader: header row, quoted fields, CRLF or LF. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows = splitRows(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const header = rows.shift();
  if (!header) return [];
  return rows.map((fields, i) => {
    if (fields.length !== header.length) {
      throw new Error(`CSV line ${i + 2}: expected ${header.length} fields, got ${fields.length}`);
    }
    return Object.fromEntries(header.map((h, j) => [h, fields[j] ?? '']));
  });
}

function splitRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}
