import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glob } from "glob";
import { parseCSharpFile, type KeywordInfo } from "../lib/csharpAttributeParser.js";
import { toWslPath } from "../lib/pathTranslate.js";

const BUILTIN_DEFAULT_ROOT = "C:\\TFS\\QEAutomation\\Selenium\\BrowserFramework\\Code\\BrowserFramework\\CostpointLib";
const CONFIG_PATH = new URL("../../ifa.config.json", import.meta.url).pathname;

function getDefaultRoot(): string {
  try {
    if (existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
      if (cfg.frameworkRootPath) return cfg.frameworkRootPath as string;
    }
  } catch {
    // fall through to built-in default
  }
  return BUILTIN_DEFAULT_ROOT;
}
const CACHE_DIR = ".ifa-cache";
const CACHE_FILE = "keywords.json";

interface CacheShape {
  fingerprint: string;
  keywords: KeywordInfo[];
}

// In-process cache: avoids re-globbing on every consolidate_evidence call within the same
// MCP server process. Cleared by forceRefresh: true (or via /recache-keywords command).
const processCache = new Map<string, ExtractKeywordsOutput>();

function computeFingerprint(root: string, files: string[]): string {
  const parts = files
    .map((f) => `${f}:${statSync(f).mtimeMs}`)
    .sort();
  return `${root}|${files.length}|${parts.join(";")}`;
}

export interface ExtractKeywordsInput {
  rootPath?: string;
  forceRefresh?: boolean;
}

export interface ExtractKeywordsOutput {
  rootPath: string;
  keywordCount: number;
  keywords: KeywordInfo[];
  cached: boolean;
}

export async function extractFrameworkKeywords(
  input: ExtractKeywordsInput
): Promise<ExtractKeywordsOutput> {
  const rootPathWindows = input.rootPath ?? getDefaultRoot();
  const rootPath = toWslPath(rootPathWindows);

  if (!existsSync(rootPath)) {
    throw new Error(`Root path does not exist: ${rootPathWindows} (resolved to ${rootPath})`);
  }

  // Return from process-level cache unless caller explicitly wants a refresh.
  if (!input.forceRefresh && processCache.has(rootPath)) {
    return processCache.get(rootPath)!;
  }

  const files = await glob("**/*.cs", { cwd: rootPath, absolute: true, nodir: true });
  const fingerprint = computeFingerprint(rootPath, files);

  const cacheDir = join(rootPath, CACHE_DIR);
  const cachePath = join(cacheDir, CACHE_FILE);

  if (!input.forceRefresh && existsSync(cachePath)) {
    try {
      const cached: CacheShape = JSON.parse(readFileSync(cachePath, "utf-8"));
      if (cached.fingerprint === fingerprint) {
        const result: ExtractKeywordsOutput = {
          rootPath: rootPathWindows,
          keywordCount: cached.keywords.length,
          keywords: cached.keywords,
          cached: true,
        };
        processCache.set(rootPath, result);
        return result;
      }
    } catch {
      // fall through to re-extraction on any cache read/parse failure
    }
  }

  const keywords: KeywordInfo[] = [];
  for (const file of files) {
    keywords.push(...parseCSharpFile(file));
  }

  try {
    mkdirSync(cacheDir, { recursive: true });
    const cache: CacheShape = { fingerprint, keywords };
    writeFileSync(cachePath, JSON.stringify(cache), "utf-8");
  } catch {
    // caching is a best-effort optimization; ignore write failures (e.g. read-only fs)
  }

  const result: ExtractKeywordsOutput = {
    rootPath: rootPathWindows,
    keywordCount: keywords.length,
    keywords,
    cached: false,
  };
  processCache.set(rootPath, result);
  return result;
}
