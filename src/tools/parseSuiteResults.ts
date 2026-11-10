import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import {
  parseSummaryDat,
  parseTestResultXml,
  type TestStep,
} from "../lib/suiteXmlParser.js";
import { toWindowsPath, toWslPath } from "../lib/pathTranslate.js";

const SCREENSHOT_RE = /^EXCEPTIONIMG_(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\.png$/i;

const EXCEPTION_TYPES = new Set(["EXCEPTIONMSG", "EXCEPTIONSTACK", "EXCEPTIONIMG", "OUTPUTFILE", "ASSERT", "ISEQUAL"]);
const LOG_TRIM_THRESHOLD = 20;
const LOG_KEEP_HEAD = 3;
const LOG_KEEP_TAIL = 5;

function trimLogMessages(messages: import("../lib/suiteXmlParser.js").LogMessage[]): import("../lib/suiteXmlParser.js").LogMessage[] {
  // Drop EXCEPTIONSTACK — the stack trace is never used in write-ups and is very large
  messages = messages.filter((m) => m.type !== "EXCEPTIONSTACK");
  if (messages.length <= LOG_TRIM_THRESHOLD) return messages;
  const firstExceptionIdx = messages.findIndex((m) => EXCEPTION_TYPES.has(m.type));
  const splitAt = firstExceptionIdx >= 0 ? firstExceptionIdx : messages.length;
  const head = messages.slice(0, LOG_KEEP_HEAD);
  const tailStart = Math.max(LOG_KEEP_HEAD, splitAt - LOG_KEEP_TAIL);
  const tail = messages.slice(tailStart);
  const omitted = tailStart - LOG_KEEP_HEAD;
  if (omitted <= 0) return messages;
  const marker: import("../lib/suiteXmlParser.js").LogMessage = {
    dateTime: "",
    type: "TRUNCATED",
    details: `[${omitted} intermediate log entries omitted]`,
  };
  return [...head, marker, ...tail];
}

function screenshotTimestampMs(fileName: string): number | undefined {
  const m = SCREENSHOT_RE.exec(fileName);
  if (!m) return undefined;
  const [, yy, mm, dd, hh, min, ss] = m;
  // 2-digit year, framework runs are all 20xx
  return Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
}

function findClosestScreenshot(runFolder: string, targetTimeIso: string): string | undefined {
  const screenshots = readdirSync(runFolder).filter((f) => SCREENSHOT_RE.test(f));
  if (screenshots.length === 0) return undefined;
  if (screenshots.length === 1) return join(runFolder, screenshots[0]);

  const targetMs = Date.parse(targetTimeIso);
  if (Number.isNaN(targetMs)) return join(runFolder, screenshots[0]);

  let best: { file: string; diff: number } | undefined;
  for (const file of screenshots) {
    const ts = screenshotTimestampMs(file);
    if (ts === undefined) continue;
    const diff = Math.abs(ts - targetMs);
    if (!best || diff < best.diff) best = { file, diff };
  }
  return best ? join(runFolder, best.file) : join(runFolder, screenshots[0]);
}

export interface FailedTestInfo {
  testName: string;
  instance: string;
  file: string;
  stepFailed: string;
  failingStep?: TestStep;
  screenshotPath?: string;
}

export interface ParseSuiteResultsOutput {
  suiteResultsPath: string;
  summary: { total: string; passed: string; failed: string; notrun: string };
  failedTests: FailedTestInfo[];
  passedTestCount: number;
}

export interface ParseSuiteResultsInput {
  suiteResultsPath: string;
}

export async function parseSuiteResults(
  input: ParseSuiteResultsInput
): Promise<ParseSuiteResultsOutput> {
  const runFolderWindows = input.suiteResultsPath;
  const runFolder = toWslPath(runFolderWindows);

  if (!existsSync(runFolder)) {
    throw new Error(`Suite results path does not exist: ${runFolderWindows} (resolved to ${runFolder})`);
  }

  const summaryDatPath = join(runFolder, "summary.dat");
  if (!existsSync(summaryDatPath)) {
    throw new Error(`summary.dat not found in ${runFolderWindows} — is this a valid suite run folder?`);
  }

  const summary = parseSummaryDat(summaryDatPath);
  const failedEntries = summary.tests.filter((t) => t.status.toLowerCase() === "failed");

  const failedTests: FailedTestInfo[] = [];
  for (const entry of failedEntries) {
    // Primary: name as stored in summary.dat. Fallback: pick the _<instance>.xml candidate
    // whose filename shares the most words with the test name (avoids wrong-test matches when
    // multiple tests share the same instance number, e.g. BLMCLOSE vs BLMBHIST both at _5.xml).
    const primaryPath = join(runFolder, `${entry.name}_${entry.instance}.xml`);
    const fallbackFile = existsSync(primaryPath)
      ? null
      : (() => {
          const suffix = `_${entry.instance}.xml`;
          const candidates = readdirSync(runFolder).filter((f) =>
            f.toLowerCase().endsWith(suffix.toLowerCase())
          );
          if (candidates.length === 0) return null;
          if (candidates.length === 1) return candidates[0];
          const nameWords = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
          let best = candidates[0];
          let bestScore = 0;
          for (const f of candidates) {
            const fl = f.toLowerCase();
            const score = nameWords.filter((w) => fl.includes(w)).length;
            if (score > bestScore) { bestScore = score; best = f; }
          }
          return best;
        })();
    const xmlPathFull = fallbackFile
      ? join(runFolder, fallbackFile)
      : existsSync(primaryPath)
      ? primaryPath
      : "";

    let failingStep: TestStep | undefined;
    let screenshotPath: string | undefined;

    if (xmlPathFull && existsSync(xmlPathFull)) {
      const testResult = parseTestResultXml(xmlPathFull);
      failingStep = testResult.steps.find((s) => s.id === testResult.stepfailed);
      if (failingStep) {
        failingStep = { ...failingStep, logmessages: trimLogMessages(failingStep.logmessages) };
        const targetTime = failingStep.end || failingStep.start;
        const resolved = findClosestScreenshot(runFolder, targetTime);
        screenshotPath = resolved ? toWindowsPath(resolved) : undefined;
      }
    }

    failedTests.push({
      testName: entry.name,
      instance: entry.instance,
      file: toWindowsPath(xmlPathFull || primaryPath),
      stepFailed: entry.step_desc?.match(/Step:\s*(\d+)/)?.[1] ?? "",
      failingStep,
      screenshotPath,
    });
  }

  return {
    suiteResultsPath: runFolderWindows,
    summary: {
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      notrun: summary.notrun,
    },
    failedTests,
    passedTestCount: summary.tests.filter((t) => t.status.toLowerCase() === "passed").length,
  };
}
