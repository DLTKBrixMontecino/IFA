import type { TestStep } from "./suiteXmlParser.js";

export interface PreRouteDecision {
  suggestedPhase: 4 | 6 | 7;
  reason: string;
}

const D_VAR_RE = /D\{[^}]+\}/;
const SYSTEM_ERROR_RE = /system\s+error\s+was\s+encountered/i;

export function preRoute(
  step: TestStep | undefined,
  screenshotPath: string | undefined,
  instance?: string
): PreRouteDecision {
  if (!step) return { suggestedPhase: 4, reason: "no failing step data" };

  // DocDiff failure — OUTPUTFILE log entry means the HTML diff is available; route straight to Phase 7
  if (
    step.keyword === "DocDiff" &&
    step.logmessages.some((lm) => lm.type === "OUTPUTFILE")
  ) {
    return {
      suggestedPhase: 7,
      reason: "DocDiff failure with output HTML available — diff rows are in bundle.docDiff",
    };
  }

  // Unresolved D{VarName} check — for multi-instance steps, only examine the slot
  // belonging to the failing instance (1-based); other slots belong to sibling instances
  // that were never substituted, so their D{...} tokens are expected and irrelevant.
  const instanceIndex = instance !== undefined ? parseInt(instance, 10) - 1 : NaN;
  const paramsToCheck =
    !isNaN(instanceIndex) && instanceIndex >= 0 && instanceIndex < step.parameters.length
      ? [step.parameters[instanceIndex]]
      : step.parameters;
  if (paramsToCheck.some((p) => D_VAR_RE.test(p))) {
    return {
      suggestedPhase: 7,
      reason: "unresolved D{VarName} token in failing step parameter — test script or data setup issue",
    };
  }

  // Assertion failure with explicit expected/actual values already in logs
  if (step.logmessages.some((lm) => lm.type === "ASSERT" || lm.type === "ISEQUAL")) {
    return {
      suggestedPhase: 7,
      reason: "assertion failure with explicit expected/actual values in logs",
    };
  }

  // Generic System Error + screenshot available — needs visual analysis, skip Phase 4
  if (
    step.logmessages.some((lm) => lm.type === "EXCEPTIONMSG" && SYSTEM_ERROR_RE.test(lm.details)) &&
    screenshotPath
  ) {
    return {
      suggestedPhase: 6,
      reason: "generic System Error with screenshot available — visual analysis needed",
    };
  }

  return { suggestedPhase: 4, reason: "ambiguous — AI analysis required" };
}
