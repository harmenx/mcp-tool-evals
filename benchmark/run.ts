import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, readApiKey } from "../src/config.js";
import { createOpenAIClient } from "../src/model.js";
import { runEval } from "../src/runner.js";

export const benchmarkRoot = path.dirname(fileURLToPath(import.meta.url));

export async function listBenchmarks(root = benchmarkRoot): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "results") continue;
    names.push(entry.name);
  }
  return names.sort();
}

interface RunOptions {
  only?: string;
  dryRun?: boolean;
  allowFailures?: boolean;
  root?: string;
}

export async function runBenchmarks(options: RunOptions = {}): Promise<number> {
  const root = options.root ?? benchmarkRoot;
  const names = await listBenchmarks(root);
  const selected = options.only ? names.filter((name) => name === options.only) : names;
  if (options.only && selected.length === 0) {
    process.stderr.write(`No benchmark named ${options.only}. Known: ${names.join(", ")}\n`);
    return 2;
  }

  let failed = 0;
  for (const name of selected) {
    const configPath = path.join(root, name, "mcp-tool-evals.yaml");
    const config = await loadConfig(configPath);
    const outDir = path.join(root, "results", name);
    config.output = {
      json: path.join(outDir, "results.json"),
      markdown: path.join(outDir, "summary.md"),
      html: path.join(outDir, "report.html"),
    };
    if (options.dryRun) {
      const command = config.server.transport === "stdio" ? [config.server.command, ...config.server.args].join(" ") : config.server.url;
      process.stdout.write(`${name}\t${config.tasks.length} tasks\t${command}\n`);
      continue;
    }
    process.stderr.write(`\n== ${name} ==\n`);
    const client = createOpenAIClient({ baseUrl: config.provider.baseUrl, apiKey: readApiKey(config) });
    const report = await runEval(config, { client });
    const bad = report.models.some((model) => model.error || model.summary.successes !== model.summary.tasks);
    if (bad) failed += 1;
  }
  if (options.dryRun) return 0;
  if (failed > 0 && !options.allowFailures) return 1;
  return 0;
}

function flag(name: string, argv: string[]): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const argv = process.argv.slice(2);
  runBenchmarks({
    only: flag("--only", argv),
    dryRun: argv.includes("--dry-run"),
    allowFailures: argv.includes("--allow-failures"),
  })
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 2;
    });
}
