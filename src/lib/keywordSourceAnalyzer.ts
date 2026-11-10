import { readFileSync, existsSync } from "node:fs";

export interface ErrorSourceContext {
  // The core error text after stripping the method-prefix pattern
  coreError: string;
  // Lines of source surrounding where the error originates (or WebDriverWait conditions)
  sourceSnippets: SourceSnippet[];
}

export interface SourceSnippet {
  lineNumber: number;
  description: string;
}

/**
 * Given an EXCEPTIONMSG and the keyword's source file, dynamically locates where
 * the error originates and returns the surrounding code context.
 *
 * Strategy:
 * 1. Strip the leading "MethodName() failed : " prefix to get the core error text.
 * 2. Search the source file for that text in string literals.
 * 3. If found: extract the N lines of context around each match.
 * 4. If not found: the error is external (e.g. Selenium timeout). Search the file for
 *    WebDriverWait declarations and extract their Until() conditions.
 */
export function analyzeErrorInSource(
  exceptionMsg: string,
  sourceFilePath: string
): ErrorSourceContext | undefined {
  if (!existsSync(sourceFilePath)) return undefined;

  const source = readFileSync(sourceFilePath, "utf-8");
  const lines = source.split("\n");

  // Strip leading "SomeMethod() failed : " or "SomeMethod() : " prefix
  const coreError = exceptionMsg.replace(/^[\w()]+\(\)\s*(failed\s*)?\s*:\s*/i, "").trim();
  if (!coreError) return undefined;

  // Step 1: search source for the core error text in string literals
  const matchLines = findTextInSource(lines, coreError);

  if (matchLines.length > 0) {
    const snippets = matchLines.map((lineIdx) => {
      const snippet = extractContext(lines, lineIdx, 6);
      return {
        lineNumber: lineIdx + 1,
        description: describeCodeContext(snippet),
      };
    });
    return { coreError, sourceSnippets: snippets };
  }

  // Step 2: error text not in source — extract WebDriverWait conditions (Selenium-generated errors)
  const waitSnippets = extractWebDriverWaitConditions(lines);
  if (waitSnippets.length > 0) {
    return { coreError, sourceSnippets: waitSnippets };
  }

  return undefined;
}

/** Search lines for the core error text appearing inside a C# string literal */
function findTextInSource(lines: string[], text: string): number[] {
  // Escape special regex characters from the error text for safe matching
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Allow partial match — use the first ~40 chars if the text is long
  const searchText = escaped.length > 40 ? escaped.slice(0, 40) : escaped;
  const re = new RegExp(searchText, "i");
  return lines.reduce<number[]>((acc, line, i) => {
    if (re.test(line)) acc.push(i);
    return acc;
  }, []);
}

/** Extract up to `radius` lines of context around a line index */
function extractContext(lines: string[], lineIdx: number, radius: number): string {
  const start = Math.max(0, lineIdx - 2);
  const end = Math.min(lines.length, lineIdx + radius);
  return lines.slice(start, end).map((l) => l.trimEnd()).join("\n");
}

/** Extract WebDriverWait declarations and their Until() conditions from the source */
function extractWebDriverWaitConditions(lines: string[]): SourceSnippet[] {
  const results: SourceSnippet[] = [];
  const waitDeclRe = /WebDriverWait\s+\w+\s*=\s*new\s+WebDriverWait/;

  for (let i = 0; i < lines.length; i++) {
    if (!waitDeclRe.test(lines[i])) continue;

    // Scan forward for the .Until( call
    for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
      if (!lines[j].includes(".Until(")) continue;

      const snippet = extractContext(lines, j, 8);
      results.push({
        lineNumber: j + 1,
        description: describeUntilCondition(snippet),
      });
      break;
    }
  }

  return results;
}

/** Produce a plain-English description of a wt.Until(...) block */
function describeUntilCondition(snippet: string): string {
  if (/pleaseWaitImage|leftLogo1|hideanim/i.test(snippet)) return "waiting for page loading spinner to disappear";
  if (/html\[wait\]|TagName\("html"\).*wait/i.test(snippet)) return "waiting for page loading indicator (html[wait] attribute) to clear";
  if (/hilite|mstrRowClass/i.test(snippet)) return "waiting for highlighted row to appear in table";
  if (/vp2N|vp2O|vScroll/i.test(snippet)) return "waiting for table vertical scroll to settle";
  if (/ElementIsVisible|elementToBeClickable|visibilityOf/i.test(snippet)) return "waiting for element to become visible or clickable";
  if (/presenceOfAll|ElementExists/i.test(snippet)) return "waiting for element to be present in DOM";
  if (/staleness|StaleElement/i.test(snippet)) return "waiting for stale element to detach";
  if (/textToBePresentIn/i.test(snippet)) return "waiting for specific text to appear in element";
  return snippet.replace(/\s+/g, " ").trim().slice(0, 150);
}

/** Produce a plain-English description of generic code context around a throw/error */
function describeCodeContext(snippet: string): string {
  if (/throw\s+new\s+Exception/i.test(snippet)) return "exception thrown here";
  if (/DlkAssert\.Assert/i.test(snippet)) return "assertion failure";
  if (/return false|return null/i.test(snippet)) return "condition not met, returning failure";
  return snippet.replace(/\s+/g, " ").trim().slice(0, 150);
}
