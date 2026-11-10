import { readFileSync } from "node:fs";

export interface DocDiffRow {
  testType: string;
  testDetails: string;
  expected: string;
  actual: string;
}

export interface DocDiffResult {
  errorCount: number;
  compareType: string;
  rows: DocDiffRow[];
}

export function parseDocDiffHtml(filePath: string): DocDiffResult {
  const html = readFileSync(filePath, "utf-8");

  // Error count: <h1 class="text-white">N</h1> immediately before "Errors found"
  const errorCountMatch = /<h1[^>]*class="[^"]*text-white[^"]*"[^>]*>(\d+)<\/h1>\s*<h5[^>]*>[^<]*Errors found/i.exec(html);
  const errorCount = errorCountMatch ? parseInt(errorCountMatch[1], 10) : 0;

  // Compare type: <h5 class="mb-3">excel</h5> (first one after "Compare Type")
  const compareTypeMatch = /Compare Type[\s\S]{0,300}?<h5[^>]*>([\w]+)<\/h5>/i.exec(html);
  const compareType = compareTypeMatch ? compareTypeMatch[1].trim() : "";

  // Data rows: <tr id="N" message-type="..."> with 4 <td> cells
  const rowRe = /<tr\s[^>]*message-type="[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const tagRe = /<[^>]+>/g;

  const rows: DocDiffRow[] = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(tagRe, "").trim());
    }
    if (cells.length >= 2) {
      rows.push({
        testType: cells[0] ?? "",
        testDetails: cells[1] ?? "",
        expected: cells[2] ?? "",
        actual: cells[3] ?? "",
      });
    }
  }

  return { errorCount, compareType, rows };
}
