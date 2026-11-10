import { readFileSync } from "node:fs";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
});

export function parseXmlFile<T = any>(filePath: string): T {
  const content = readFileSync(filePath, "utf-8");
  return parser.parse(content) as T;
}

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export interface SummaryTestEntry {
  name: string;
  filepath: string;
  id: string;
  instance: string;
  instanceid: string;
  status: string;
  start_time: string;
  end_time: string;
  elapsed: string;
  step_desc?: string;
  step_info?: string;
  errormessage?: string;
  errorstack?: string;
  errorscreenshot?: string;
  executedsteps?: string;
  totalsteps?: string;
  testcaseid?: string;
  testcasename?: string;
}

export interface SuiteSummary {
  name: string;
  path: string;
  elapsed: string;
  total: string;
  failed: string;
  passed: string;
  notrun: string;
  machinename: string;
  starttime: string;
  endtime: string;
  tests: SummaryTestEntry[];
}

export function parseSummaryDat(filePath: string): SuiteSummary {
  const doc = parseXmlFile<any>(filePath);
  const summary = doc.summary ?? {};
  const tests = asArray<any>(summary.test).map((t) => ({
    name: String(t.name ?? ""),
    filepath: String(t.filepath ?? ""),
    id: String(t.id ?? ""),
    instance: String(t.instance ?? ""),
    instanceid: String(t.instanceid ?? ""),
    status: String(t.status ?? ""),
    start_time: String(t.start_time ?? ""),
    end_time: String(t.end_time ?? ""),
    elapsed: String(t.elapsed ?? ""),
    step_desc: t.step_desc ? String(t.step_desc) : undefined,
    step_info: t.step_info ? String(t.step_info) : undefined,
    errormessage: t.errormessage ? String(t.errormessage) : undefined,
    errorstack: t.errorstack ? String(t.errorstack) : undefined,
    errorscreenshot: t.errorscreenshot ? String(t.errorscreenshot) : undefined,
    executedsteps: t.executedsteps ? String(t.executedsteps) : undefined,
    totalsteps: t.totalsteps ? String(t.totalsteps) : undefined,
    testcaseid: t.testcaseid ? String(t.testcaseid) : undefined,
    testcasename: t.testcasename ? String(t.testcasename) : undefined,
  }));

  return {
    name: String(summary["@_name"] ?? ""),
    path: String(summary["@_path"] ?? ""),
    elapsed: String(summary["@_elapsed"] ?? ""),
    total: String(summary["@_total"] ?? ""),
    failed: String(summary["@_failed"] ?? ""),
    passed: String(summary["@_passed"] ?? ""),
    notrun: String(summary["@_notrun"] ?? ""),
    machinename: String(summary["@_machinename"] ?? ""),
    starttime: String(summary["@_starttime"] ?? ""),
    endtime: String(summary["@_endtime"] ?? ""),
    tests,
  };
}

export interface LogMessage {
  dateTime: string;
  type: string;
  details: string;
}

export interface TestStep {
  id: string;
  execute: string;
  screen: string;
  control: string;
  keyword: string;
  parameters: string[];
  delay: string;
  status: string;
  logmessages: LogMessage[];
  start: string;
  end: string;
  elapsed: string;
}

export interface TestResult {
  name: string;
  file: string;
  identifier: string;
  instance: string;
  instanceid: string;
  status: string;
  stepfailed: string;
  start: string;
  end: string;
  elapsed: string;
  steps: TestStep[];
}

function parseLogMessages(raw: any): LogMessage[] {
  return asArray<any>(raw?.logmessage).map((lm) => ({
    dateTime: String(lm["@_MessageDateTime"] ?? ""),
    type: String(lm["@_MessageType"] ?? ""),
    details: String(lm["@_MessageDetails"] ?? ""),
  }));
}

export function parseTestResultXml(filePath: string): TestResult {
  const doc = parseXmlFile<any>(filePath);
  const test = doc.test ?? {};
  const steps = asArray<any>(test.steps?.step).map((s) => ({
    id: String(s["@_id"] ?? ""),
    execute: String(s.execute ?? ""),
    screen: String(s.screen ?? ""),
    control: String(s.control ?? ""),
    keyword: String(s.keyword ?? ""),
    parameters: asArray<any>(s.parameters?.parameter).map((p) =>
      typeof p === "object" ? "" : String(p ?? "")
    ),
    delay: String(s.delay ?? ""),
    status: String(s.status ?? ""),
    logmessages: parseLogMessages(s.logmessages),
    start: String(s.start ?? ""),
    end: String(s.end ?? ""),
    elapsed: String(s.elapsed ?? ""),
  }));

  return {
    name: String(test.name ?? ""),
    file: String(test.file ?? ""),
    identifier: String(test.identifier ?? ""),
    instance: String(test.instance ?? ""),
    instanceid: String(test.instanceid ?? ""),
    status: String(test.status ?? ""),
    stepfailed: String(test.stepfailed ?? ""),
    start: String(test.start ?? ""),
    end: String(test.end ?? ""),
    elapsed: String(test.elapsed ?? ""),
    steps,
  };
}
