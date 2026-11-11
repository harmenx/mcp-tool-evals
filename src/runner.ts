import { readApiKey, serverTarget, type LoadedConfig } from "./config.js";
import { UserError } from "./errors.js";
import { runTaskLoop } from "./loop.js";
import { connectServer, type ListedTool } from "./mcp.js";
import { createOpenAIClient, type ModelClient } from "./model.js";
import { renderMarkdown, writeReport } from "./report.js";
import { scoreTask, summarize } from "./score.js";
import type { EvalReport, ModelReport } from "./types.js";
import { isRecord } from "./util.js";

export interface RunOptions {
  client?: ModelClient;
  env?: NodeJS.ProcessEnv;
  verbose?: boolean;
  signal?: AbortSignal;
  onLine?: (line: string) => void;
}

export async function runEval(config: LoadedConfig, options: RunOptions = {}): Promise<EvalReport> {
  if (config.tasksMissing) {
    throw new UserError(`Tasks file not found: ${config.tasksPath ?? "(missing)"}. Run \`mcp-tool-evals generate\` first.`);
  }
  if (config.tasks.length === 0) throw new UserError("No tasks to run.");

  const client = options.client ?? createOpenAIClient({
    baseUrl: config.provider.baseUrl,
    apiKey: readApiKey(config, options.env),
  });
  const startedAt = new Date();
  const report: EvalReport = {
    version: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    server: {
      name: "unknown",
      version: "",
      transport: config.server.transport,
      target: serverTarget(config.server),
    },
    tools: [],
    models: [],
  };

  for (const model of config.models) {
    const modelReport = await runModel(config, model, client, report, options);
    report.models.push(modelReport);
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(report, config.output);
  return report;
}

export async function runAndPrint(config: LoadedConfig, options: RunOptions = {}): Promise<EvalReport> {
  const report = await runEval(config, options);
  process.stdout.write(renderMarkdown(report));
  return report;
}

async function runModel(
  config: LoadedConfig,
  model: LoadedConfig["models"][number],
  client: ModelClient,
  report: EvalReport,
  options: RunOptions,
): Promise<ModelReport> {
  let session: Awaited<ReturnType<typeof connectServer>> | undefined;
  try {
    session = await connectServer(config.server, { verbose: options.verbose });
    const tools = await session.listTools();
    if (report.tools.length === 0) {
      report.server.name = session.serverName ?? "unknown";
      report.server.version = session.serverVersion ?? "";
      report.tools = tools.map((tool) => {
        const listed: EvalReport["tools"][number] = { name: tool.name };
        if (tool.description) listed.description = tool.description;
        return listed;
      });
    }
    const tasks = [];
    for (const task of config.tasks) {
      const run = await runTaskLoop({
        task,
        tools,
        session,
        client,
        model: model.model,
        maxTurns: config.limits.maxTurns,
        timeoutMs: config.limits.timeoutMs,
        signal: options.signal,
      });
      const scored = await scoreTask({
        task,
        run,
        model,
        client,
        judgeModel: config.judgeModel ?? model.model,
        timeoutMs: config.limits.timeoutMs,
        signal: options.signal,
      });
      tasks.push(scored);
      options.onLine?.(progressLine(model.name, scored));
      if (options.verbose) {
        for (const call of scored.toolCalls) {
          options.onLine?.(`  ${call.name} ${call.argumentsText} valid=${call.valid} error=${call.isError}`);
        }
      }
    }
    return { name: model.name, model: model.model, summary: summarize(tasks), tasks };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onLine?.(`fail  ${model.name}  ${message}`);
    return { name: model.name, model: model.model, summary: summarize([]), tasks: [], error: message };
  } finally {
    await session?.close();
  }
}

function progressLine(model: string, task: { id: string; success: boolean; toolCalls: unknown[]; promptTokens: number; completionTokens: number; latencyMs: number }): string {
  const mark = task.success ? "pass" : "fail";
  const tokens = task.promptTokens + task.completionTokens;
  return `${mark}  ${model}  ${task.id}  tools=${task.toolCalls.length}  tokens=${tokens}  ${task.latencyMs}ms`;
}

export function describeTools(tools: ListedTool[]): string {
  return tools
    .map((tool) => {
      const header = tool.description ? `${tool.name}\n  ${tool.description}` : tool.name;
      const args = describeParameters(tool.inputSchema);
      return args ? `${header}\n  arguments: ${args}` : header;
    })
    .join("\n\n");
}

function describeParameters(schema: Record<string, unknown>): string {
  if (!isRecord(schema.properties)) return "";
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : []);
  return Object.entries(schema.properties)
    .map(([name, property]) => {
      const type = isRecord(property) && (typeof property.type === "string" || Array.isArray(property.enum))
        ? schemaType(property)
        : "any";
      return `${name}: ${type}${required.has(name) ? "" : "?"}`;
    })
    .join(", ");
}

function schemaType(property: Record<string, unknown>): string {
  if (Array.isArray(property.enum)) return property.enum.map((item) => JSON.stringify(item)).join("|");
  return typeof property.type === "string" ? property.type : "any";
}
