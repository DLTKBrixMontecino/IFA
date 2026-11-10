import { existsSync, readdirSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import { parseSuiteResults } from "./parseSuiteResults.js";
import { toWindowsPath, toWslPath } from "../lib/pathTranslate.js";

const RUN_FOLDER_RE = /^\d{14}$/;

export interface FindPreviousRunInput {
  suiteResultsPath: string;
}

export interface FindPreviousRunOutput {
  currentRunPath: string;
  previousRunPath?: string;
  previousRunSummary?: Awaited<ReturnType<typeof parseSuiteResults>>;
}

export async function findPreviousRun(
  input: FindPreviousRunInput
): Promise<FindPreviousRunOutput> {
  const currentRunWsl = toWslPath(input.suiteResultsPath);
  const currentRunName = basename(currentRunWsl);
  const suiteFolder = dirname(currentRunWsl);

  if (!existsSync(suiteFolder)) {
    throw new Error(`Suite folder does not exist: ${toWindowsPath(suiteFolder)}`);
  }

  const siblingRuns = readdirSync(suiteFolder)
    .filter((name) => RUN_FOLDER_RE.test(name))
    .sort();

  const currentIdx = siblingRuns.indexOf(currentRunName);
  const priorRuns = currentIdx >= 0 ? siblingRuns.slice(0, currentIdx) : siblingRuns.filter((n) => n < currentRunName);

  if (priorRuns.length === 0) {
    return { currentRunPath: input.suiteResultsPath };
  }

  const previousRunName = priorRuns[priorRuns.length - 1];
  const previousRunWsl = join(suiteFolder, previousRunName);
  const previousRunWindows = toWindowsPath(previousRunWsl);

  const previousRunSummary = await parseSuiteResults({ suiteResultsPath: previousRunWindows });

  return {
    currentRunPath: input.suiteResultsPath,
    previousRunPath: previousRunWindows,
    previousRunSummary,
  };
}
