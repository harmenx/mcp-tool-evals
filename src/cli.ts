#!/usr/bin/env node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { findRegressions, readSuccessRatesFile, renderDiff } from "./baseline.js";
import { loadConfig, readApiKey } from "./config.js";
import { UserError } from "./errors.js";
import { generateTasks, readTasksFile, renderTasks } from "./generate.js";
import { scaffoldConfig } from "./init.js";
import { connectServer } from "./mcp.js";
import { createOpenAIClient } from "./model.js";
import { describeTools, runAndPrint } from "./runner.js";

interface Flags {
  config?: string;
  out?: string;
  count?: string;
  model?: string;
  dir?: string;
  json?: string;
  markdown?: string;
  html?: string;
  current?: string;
  baseline?: string;
  threshold?: string;
  requirePerfect: boolean;
  force: boolean;
  verbose: boolean;
  allowFailures: boolean;
  help: boolean;
}

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c" },
      out: { type: "string", short: "o" },
      count: { type: "string", short: "n" },
      model: { type: "string", short: "m" },
      dir: { type: "string", short: "d" },
      json: { type: "string" },
      markdown: { type: "string" },
      html: { type: "string" },
      current: { type: "string" },
      baseline: { type: "string" },
      threshold: { type: "string" },
      "require-perfect": { type: "boolean", default: false },
      force: { type: "boolean", short: "f", default: false },
      verbose: { type: "boolean", short: "v", default: false },
      "allow-failures": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const flags: Flags = {
    config: values.config,
    out: values.out,
    count: values.count,
    model: values.model,
    dir: values.dir,
    json: values.json,
    markdown: values.markdown,
    html: values.html,
    current: values.current,
    baseline: values.baseline,
    threshold: values.threshold,
    requirePerfect: values["require-perfect"],
    force: values.force,
    verbose: values.verbose,
    allowFailures: values["allow-failures"],
    help: values.help,
  };
  const command = positionals[0] ?? "help";
  if (flags.help || command === "help") {
    process.stdout.write(helpText());
    return 0;
  }
  if (positionals.length > 1) throw new UserError(`Unexpected argument "${positionals[1]}".`);

  if (command === "init") {
    const dir = path.resolve(flags.dir ?? ".");
    const configPath = await scaffoldConfig(dir, flags.force);
    process.stdout.write(`Wrote ${configPath}\nEdit the server command, then run: mcp-tool-evals generate -c ${configPath}\n`);
    return 0;
  }
  if (command === "tools") {
    const config = await loadConfig(requiredConfig(flags));
    const session = await connectServer(config.server, { verbose: flags.verbose });
    try {
      const tools = await session.listTools();
      const name = [session.serverName, session.serverVersion].filter(Boolean).join(" ");
      process.stdout.write(`${name}\n\n${describeTools(tools)}\n`);
    } finally {
      await session.close();
    }
    return 0;
  }
  if (command === "generate") {
    const config = await loadConfig(requiredConfig(flags));
    const count = flags.count === undefined ? 4 : Number(flags.count);
    if (!Number.isInteger(count)) throw new UserError("--count must be an integer.");
    const model = flags.model ?? config.judgeModel ?? config.models[0]?.model;
    if (!model) throw new UserError("No model is configured to draft tasks.");
    const client = createOpenAIClient({ baseUrl: config.provider.baseUrl, apiKey: readApiKey(config) });
    const tasks = await generateTasks({ config, count, model, client });
    const destination = path.resolve(flags.out ?? config.tasksPath ?? path.join(config.configDir, "tasks.yaml"));
    if (!flags.force && (await readTasksFile(destination))) {
      throw new UserError(`${destination} already exists. Pass --force to overwrite it.`);
    }
    await writeFile(destination, renderTasks(tasks), "utf8");
    process.stdout.write(`Wrote ${tasks.length} tasks to ${destination}\n`);
    return 0;
  }
  if (command === "diff") {
    if (!flags.current) throw new UserError("Pass --current <results.json>.");
    if (!flags.baseline && !flags.requirePerfect) throw new UserError("Pass --baseline <file> or --require-perfect.");
    const current = await readSuccessRatesFile(path.resolve(flags.current));
    let failed = false;
    if (flags.baseline) {
      const threshold = flags.threshold === undefined ? 0 : Number(flags.threshold);
      if (!Number.isFinite(threshold)) throw new UserError("--threshold must be a number from 0 to 1.");
      const previous = await readSuccessRatesFile(path.resolve(flags.baseline));
      process.stdout.write(renderDiff(current, previous, threshold));
      failed = findRegressions(current, previous, threshold).length > 0;
    }
    if (flags.requirePerfect) {
      const missed = current.filter((model) => model.taskSuccessRate < 1);
      if (missed.length > 0) {
        process.stdout.write(`Not every task passed: ${missed.map((model) => model.name).join(", ")}.\n`);
        failed = true;
      }
    }
    return failed ? 1 : 0;
  }
  if (command === "run") {
    const config = await loadConfig(requiredConfig(flags));
    if (flags.json) config.output.json = path.resolve(flags.json);
    if (flags.markdown) config.output.markdown = path.resolve(flags.markdown);
    if (flags.html) config.output.html = path.resolve(flags.html);
    const report = await runAndPrint(config, {
      verbose: flags.verbose,
      onLine: (line) => process.stderr.write(`${line}\n`),
    });
    for (const file of [config.output.json, config.output.markdown, config.output.html]) {
      if (file) process.stderr.write(`wrote ${file}\n`);
    }
    const failed = report.models.some((model) => model.error || model.summary.successes !== model.summary.tasks);
    return failed && !flags.allowFailures ? 1 : 0;
  }
  throw new UserError(`Unknown command "${command}". Run mcp-tool-evals help.`);
}

function requiredConfig(flags: Flags): string {
  if (!flags.config) throw new UserError("Pass --config <file>.");
  return flags.config;
}

function helpText(): string {
  return `mcp-tool-evals — test whether models pick and call MCP tools correctly

Usage:
  mcp-tool-evals run --config mcp-tool-evals.yaml
  mcp-tool-evals tools --config mcp-tool-evals.yaml
  mcp-tool-evals generate --config mcp-tool-evals.yaml [--out tasks.yaml] [--count 4]
  mcp-tool-evals init [--dir .]
  mcp-tool-evals diff --current results.json --baseline baseline.json [--threshold 0.05]

Commands:
  run        Run every task on every model and write JSON, Markdown, and HTML reports
  tools      Connect and print the server's tools
  generate   Ask a model to draft tasks from the server's tool schemas
  init       Write a starter config in the current directory
  diff       Fail when task success drops past a baseline threshold

Options:
  -c, --config <file>     Config file (required except for init)
  -o, --out <file>        Where generate writes tasks
  -n, --count <n>         How many tasks generate should draft (1-20, default 4)
  -m, --model <id>        Model id used by generate
  -d, --dir <dir>         Directory for init
      --json <file>       Override the JSON report path
      --markdown <file>   Override the Markdown report path
      --html <file>       Override the HTML report path
      --current <file>    Results JSON for diff
      --baseline <file>   Baseline JSON for diff (full report or {models:[{name, taskSuccessRate}]})
      --threshold <n>     Allowed drop in task success, from 0 to 1 (default 0)
      --require-perfect   Also fail when any model's success rate is below 1
  -f, --force             Overwrite an existing config or tasks file
  -v, --verbose           Print server logs and each tool call
      --allow-failures    Exit 0 even when a task fails
  -h, --help

The model endpoint is OpenAI-compatible. Set the API key named by provider.apiKeyEnv
(OPENAI_API_KEY by default) and, if you use a proxy, OPENAI_BASE_URL.

Exit 0 when every task passes, 1 when a task or a model fails, 2 on a usage or config error.
`;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 2;
    });
}
