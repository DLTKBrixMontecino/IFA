import { readFileSync } from "node:fs";

export interface KeywordParameter {
  index: string;
  type: string;
  label: string;
  sample: string;
}

export interface KeywordInfo {
  keyword: string;
  owner: { kind: "Control" | "Function"; name: string };
  parameters: KeywordParameter[];
  description?: string;
  file: string;
  line: number;
}

const OWNER_RE = /\[(ControlType|Component)\("([^"]+)"\)\]\s*\r?\n\s*(?:public|internal)?\s*(?:static\s+)?(?:partial\s+)?class\s+(\w+)/g;

// Matches `[Keyword("Name")]` or `[Keyword("Name", new String[] { ... })]` (array body may span multiple lines).
const KEYWORD_RE = /\[Keyword\(\s*"([^"]+)"\s*(?:,\s*new\s+(?:String|string)\[\]\s*\{([\s\S]*?)\}\s*)?\)\]/g;

const STRING_LITERAL_RE = /@?"((?:[^"\\]|\\.)*)"/g;

function parsePipeSegments(raw: string): KeywordParameter {
  const segments = raw.split("|");
  if (segments.length <= 1) {
    return { index: "", type: "", label: "", sample: raw };
  }
  const [index, type, ...rest] = segments;
  if (rest.length === 0) {
    return { index, type: "", label: "", sample: type };
  }
  if (rest.length === 1) {
    return { index, type, label: "", sample: rest[0] };
  }
  const label = rest[0];
  const sample = rest.slice(1).join("|");
  return { index, type, label, sample };
}

function lineNumberAt(content: string, charIndex: number): number {
  let line = 1;
  for (let i = 0; i < charIndex; i++) {
    if (content[i] === "\n") line++;
  }
  return line;
}

function extractPrecedingDocComment(content: string, attributeStart: number): string | undefined {
  const before = content.slice(0, attributeStart);
  const lines = before.split(/\r?\n/);
  const summaryLines: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (trimmed.startsWith("///")) {
      summaryLines.unshift(trimmed.replace(/^\/\/\/\s?/, ""));
      continue;
    }
    break;
  }
  if (summaryLines.length === 0) return undefined;
  const joined = summaryLines.join(" ");
  const match = /<summary>\s*(.*?)\s*<\/summary>/.exec(joined);
  return (match ? match[1] : joined).trim() || undefined;
}

interface OwnerSpan {
  kind: "Control" | "Function";
  name: string;
  start: number;
}

function findOwnerSpans(content: string): OwnerSpan[] {
  const spans: OwnerSpan[] = [];
  OWNER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OWNER_RE.exec(content)) !== null) {
    const [, attr, name] = m;
    spans.push({
      kind: attr === "ControlType" ? "Control" : "Function",
      name,
      start: m.index,
    });
  }
  return spans;
}

function ownerForPosition(spans: OwnerSpan[], pos: number): OwnerSpan | undefined {
  let best: OwnerSpan | undefined;
  for (const span of spans) {
    if (span.start <= pos && (!best || span.start > best.start)) {
      best = span;
    }
  }
  return best;
}

export function parseCSharpFile(filePath: string): KeywordInfo[] {
  const content = readFileSync(filePath, "utf-8");
  const owners = findOwnerSpans(content);
  const results: KeywordInfo[] = [];

  KEYWORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = KEYWORD_RE.exec(content)) !== null) {
    const [, keywordName, arrayBody] = m;
    const owner = ownerForPosition(owners, m.index);
    if (!owner) continue;

    const parameters: KeywordParameter[] = [];
    if (arrayBody) {
      STRING_LITERAL_RE.lastIndex = 0;
      let lit: RegExpExecArray | null;
      while ((lit = STRING_LITERAL_RE.exec(arrayBody)) !== null) {
        parameters.push(parsePipeSegments(lit[1]));
      }
    }

    results.push({
      keyword: keywordName,
      owner: { kind: owner.kind, name: owner.name },
      parameters,
      description: extractPrecedingDocComment(content, m.index),
      file: filePath,
      line: lineNumberAt(content, m.index),
    });
  }

  return results;
}
