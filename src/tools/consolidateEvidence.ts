import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { extractFrameworkKeywords } from "./extractKeywords.js";
import { parseSuiteResults } from "./parseSuiteResults.js";
import { parseTestResultXml, type TestStep } from "../lib/suiteXmlParser.js";
import { toWslPath } from "../lib/pathTranslate.js";
import type { KeywordInfo } from "../lib/csharpAttributeParser.js";
import { parseDocDiffHtml, type DocDiffResult } from "../lib/docDiffParser.js";
import { preRoute, type PreRouteDecision } from "../lib/preRouter.js";
import { analyzeErrorInSource, type ErrorSourceContext } from "../lib/keywordSourceAnalyzer.js";

export interface ConsolidateEvidenceInput {
  suiteResultsPath: string;
  frameworkRootPath?: string;
  contextStepCount?: number;
}

export interface EvidenceBundle {
  testName: string;
  instance: string;
  stepFailed: string;
  failingStep?: TestStep;
  keywordDefinition?: KeywordInfo;
  precedingSteps: TestStep[];
  screenshotPath?: string;
  docDiff?: DocDiffResult;
  errorSourceContext?: ErrorSourceContext;
  route: PreRouteDecision;
}

export interface ConsolidateEvidenceOutput {
  suiteResultsPath: string;
  bundles: EvidenceBundle[];
}

export async function consolidateEvidence(
  input: ConsolidateEvidenceInput
): Promise<ConsolidateEvidenceOutput> {
  const contextStepCount = input.contextStepCount ?? 5;

  const [{ keywords }, suiteResult] = await Promise.all([
    extractFrameworkKeywords({ rootPath: input.frameworkRootPath }),
    parseSuiteResults({ suiteResultsPath: input.suiteResultsPath }),
  ]);

  const keywordByName = new Map<string, KeywordInfo>();
  for (const k of keywords) {
    if (!keywordByName.has(k.keyword)) keywordByName.set(k.keyword, k);
  }

  const bundles: EvidenceBundle[] = [];

  for (const failed of suiteResult.failedTests) {
    const xmlPath = toWslPath(failed.file);
    let precedingSteps: TestStep[] = [];

    if (existsSync(xmlPath)) {
      const testResult = parseTestResultXml(xmlPath);
      const failIdx = testResult.steps.findIndex((s) => s.id === testResult.stepfailed);
      if (failIdx > 0) {
        precedingSteps = testResult.steps
          .slice(Math.max(0, failIdx - contextStepCount), failIdx)
          .map((s) => ({
            ...s,
            // Strip log messages from passing steps — they add bulk without diagnostic value
            logmessages: s.status === "Passed" || s.status === "Not run" ? [] : s.logmessages,
          }));
      }
    }

    // Resolve DocDiff output HTML: the OUTPUTFILE log entry records the path on the
    // test runner machine; look for the same filename in the suite results folder instead.
    let docDiff: DocDiffResult | undefined;
    const outputFileLog = failed.failingStep?.logmessages.find((lm) => lm.type === "OUTPUTFILE");
    if (outputFileLog) {
      const rawOutputPath = outputFileLog.details.replace(/^Image:\s*/i, "").trim();
      const htmlName = rawOutputPath.split(/[\\/]/).pop() ?? "";
      const runFolderWsl = toWslPath(input.suiteResultsPath);
      const htmlPath = join(runFolderWsl, htmlName);
      if (existsSync(htmlPath)) {
        try {
          docDiff = parseDocDiffHtml(htmlPath);
        } catch {
          // silently skip unparseable DocDiff output
        }
      }
    }

    // For any EXCEPTIONMSG, dynamically locate where the error originates in the
    // keyword source file and attach that context so AI can interpret the failure
    // without manually reading the source.
    let errorSourceContext: ErrorSourceContext | undefined;
    const exceptionMsg = failed.failingStep?.logmessages.find((lm) => lm.type === "EXCEPTIONMSG")?.details ?? "";
    if (exceptionMsg) {
      const kwDef = failed.failingStep?.keyword ? keywordByName.get(failed.failingStep.keyword) : undefined;
      if (kwDef?.file) {
        errorSourceContext = analyzeErrorInSource(exceptionMsg, kwDef.file) ?? undefined;
      }
    }

    const keywordName = failed.failingStep?.keyword;
    bundles.push({
      testName: failed.testName,
      instance: failed.instance,
      stepFailed: failed.stepFailed,
      failingStep: failed.failingStep,
      keywordDefinition: keywordName ? keywordByName.get(keywordName) : undefined,
      precedingSteps,
      screenshotPath: failed.screenshotPath,
      docDiff,
      errorSourceContext,
      route: preRoute(failed.failingStep, failed.screenshotPath, failed.instance),
    });
  }

  return { suiteResultsPath: input.suiteResultsPath, bundles };
}
