import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { UserError } from "./errors.js";
import { parseTasks, type EvalTask } from "./tasks.js";
import { interpolateValue, isRecord } from "./util.js";

export interface StdioServerConfig {
  transport: "stdio";
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

export interface HttpServerConfig {
  transport: "http";
  url: string;
  headers?: Record<string, string>;
}

export type ServerConfig = StdioServerConfig | HttpServerConfig;

export interface ModelConfig {
  name: string;
  model: string;
  inputPerMillion?: number;
  outputPerMillion?: number;
}

export interface ProviderConfig {
  baseUrl: string;
  apiKeyEnv: string;
}

export interface LoadedConfig {
  configPath: string;
  configDir: string;
  server: ServerConfig;
  provider: ProviderConfig;
  models: ModelConfig[];
  tasks: EvalTask[];
  tasksPath?: string;
  tasksMissing: boolean;
  limits: { maxTurns: number; timeoutMs: number };
  judgeModel?: string;
  output: { json?: string; markdown?: string; html?: string };
}

export async function loadConfig(file: string, env: NodeJS.ProcessEnv = process.env): Promise<LoadedConfig> {
  const configPath = path.resolve(file);
  const configDir = path.dirname(configPath);
  const raw = await readConfigFile(configPath);
  if (!isRecord(raw)) throw new UserError(`${configPath} must contain a YAML object.`);
  rejectUnknown(
    raw,
    ["server", "provider", "models", "tasks", "limits", "judge", "output"],
    path.basename(configPath),
  );

  const server = parseServer(interpolateValue(raw.server, env), configDir, `${path.basename(configPath)}.server`);
  const provider = parseProvider(interpolateValue(raw.provider, env), `${path.basename(configPath)}.provider`);
  const models = parseModels(raw.models, `${path.basename(configPath)}.models`);
  const limits = parseLimits(raw.limits, `${path.basename(configPath)}.limits`);
  const judgeModel = parseJudge(raw.judge, `${path.basename(configPath)}.judge`);
  const output = parseOutput(raw.output, configDir, `${path.basename(configPath)}.output`);
  const loadedTasks = await parseTasksField(raw.tasks, configDir, `${path.basename(configPath)}.tasks`);

  return {
    configPath,
    configDir,
    server,
    provider,
    models,
    tasks: loadedTasks.tasks,
    tasksPath: loadedTasks.tasksPath,
    tasksMissing: loadedTasks.missing,
    limits,
    judgeModel,
    output,
  };
}

export function readApiKey(config: LoadedConfig, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[config.provider.apiKeyEnv];
  if (!value) {
    throw new UserError(
      `Set ${config.provider.apiKeyEnv} to the API key for ${config.provider.baseUrl}.`,
    );
  }
  return value;
}

export function serverTarget(server: ServerConfig): string {
  if (server.transport === "http") return server.url;
  return [server.command, ...server.args].join(" ");
}

async function parseTasksField(
  value: unknown,
  configDir: string,
  label: string,
): Promise<{ tasks: EvalTask[]; tasksPath?: string; missing: boolean }> {
  if (typeof value === "string") {
    const tasksPath = path.resolve(configDir, value);
    try {
      const document = await readYamlFile(tasksPath);
      return { tasks: parseTasks(document, path.basename(tasksPath)), tasksPath, missing: false };
    } catch (error) {
      if (isNotFound(error)) return { tasks: [], tasksPath, missing: true };
      throw error;
    }
  }
  if (value === undefined) return { tasks: [], missing: false };
  return { tasks: parseTasks(value, label), missing: false };
}

function parseServer(value: unknown, configDir: string, label: string): ServerConfig {
  if (!isRecord(value)) throw new UserError(`${label} must be an object.`);
  const transport = requiredString(value.transport, `${label}.transport`);
  if (transport === "stdio") {
    rejectUnknown(value, ["transport", "command", "args", "cwd", "env"], label);
    const command = requiredString(value.command, `${label}.command`);
    const args = stringArray(value.args, `${label}.args`);
    const cwd = value.cwd === undefined ? configDir : path.resolve(configDir, requiredString(value.cwd, `${label}.cwd`));
    const env = stringRecord(value.env, `${label}.env`);
    return env ? { transport, command, args, cwd, env } : { transport, command, args, cwd };
  }
  if (transport === "http") {
    rejectUnknown(value, ["transport", "url", "headers"], label);
    const url = requiredString(value.url, `${label}.url`);
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new UserError(`${label}.url must start with http:// or https://.`);
      }
    } catch (error) {
      if (error instanceof UserError) throw error;
      throw new UserError(`${label}.url is not a valid URL.`);
    }
    const headers = stringRecord(value.headers, `${label}.headers`);
    return headers ? { transport, url, headers } : { transport, url };
  }
  throw new UserError(`${label}.transport must be stdio or http.`);
}

function parseProvider(value: unknown, label: string): ProviderConfig {
  if (!isRecord(value)) throw new UserError(`${label} must be an object.`);
  rejectUnknown(value, ["baseUrl", "apiKeyEnv"], label);
  const baseUrl = requiredString(value.baseUrl, `${label}.baseUrl`);
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new UserError(`${label}.baseUrl must start with http:// or https://.`);
    }
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError(`${label}.baseUrl is not a valid URL.`);
  }
  return {
    baseUrl,
    apiKeyEnv: requiredString(value.apiKeyEnv, `${label}.apiKeyEnv`),
  };
}

function parseModels(value: unknown, label: string): ModelConfig[] {
  if (!Array.isArray(value) || value.length === 0) throw new UserError(`${label} must list at least one model.`);
  const names = new Set<string>();
  return value.map((item, index) => {
    const path = `${label}[${index}]`;
    if (!isRecord(item)) throw new UserError(`${path} must be an object.`);
    rejectUnknown(item, ["name", "model", "inputPerMillion", "outputPerMillion"], path);
    const name = requiredString(item.name, `${path}.name`);
    if (names.has(name)) throw new UserError(`${path}.name "${name}" is duplicated.`);
    names.add(name);
    const model: ModelConfig = { name, model: requiredString(item.model, `${path}.model`) };
    const input = optionalNumber(item.inputPerMillion, `${path}.inputPerMillion`);
    const output = optionalNumber(item.outputPerMillion, `${path}.outputPerMillion`);
    if (input !== undefined) model.inputPerMillion = input;
    if (output !== undefined) model.outputPerMillion = output;
    return model;
  });
}

function parseLimits(value: unknown, label: string): { maxTurns: number; timeoutMs: number } {
  if (value === undefined) return { maxTurns: 4, timeoutMs: 60_000 };
  if (!isRecord(value)) throw new UserError(`${label} must be an object.`);
  rejectUnknown(value, ["maxTurns", "timeoutMs"], label);
  const maxTurns = value.maxTurns === undefined ? 4 : optionalNumber(value.maxTurns, `${label}.maxTurns`);
  const timeoutMs = value.timeoutMs === undefined ? 60_000 : optionalNumber(value.timeoutMs, `${label}.timeoutMs`);
  if (maxTurns === undefined || !Number.isInteger(maxTurns) || maxTurns < 1) {
    throw new UserError(`${label}.maxTurns must be an integer >= 1.`);
  }
  if (timeoutMs === undefined || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new UserError(`${label}.timeoutMs must be an integer >= 1.`);
  }
  return { maxTurns, timeoutMs };
}

function parseJudge(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new UserError(`${label} must be an object.`);
  rejectUnknown(value, ["model"], label);
  return value.model === undefined ? undefined : requiredString(value.model, `${label}.model`);
}

function parseOutput(value: unknown, configDir: string, label: string): { json?: string; markdown?: string; html?: string } {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new UserError(`${label} must be an object.`);
  rejectUnknown(value, ["json", "markdown", "html"], label);
  const output: { json?: string; markdown?: string; html?: string } = {};
  if (value.json !== undefined) output.json = path.resolve(configDir, requiredString(value.json, `${label}.json`));
  if (value.markdown !== undefined) {
    output.markdown = path.resolve(configDir, requiredString(value.markdown, `${label}.markdown`));
  }
  if (value.html !== undefined) output.html = path.resolve(configDir, requiredString(value.html, `${label}.html`));
  return output;
}

async function readConfigFile(file: string): Promise<unknown> {
  try {
    return await readYamlFile(file);
  } catch (error) {
    if (isNotFound(error)) throw new UserError(`File not found: ${file}`);
    throw error;
  }
}

async function readYamlFile(file: string): Promise<unknown> {
  const text = await readFile(file, "utf8");
  try {
    return parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserError(`Could not parse ${file}: ${message}`);
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new UserError(`${label} must be a list of strings.`);
  }
  return value;
}

function stringRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new UserError(`${label} must be a map of strings.`);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, String(item)]));
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new UserError(`${label} must be a non-empty string.`);
  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) throw new UserError(`${label} must be a number.`);
  return value;
}

function rejectUnknown(value: Record<string, unknown>, allowed: string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new UserError(`${label} has unknown fields: ${extra.join(", ")}.`);
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}
