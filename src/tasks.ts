import { UserError } from "./errors.js";
import { isRecord } from "./util.js";

const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const CHECK_KEYS = new Set(["equals", "contains", "regex", "type"]);
const TYPE_NAMES = new Set(["string", "number", "integer", "boolean", "object", "array"]);

export interface FieldCheck {
  equals?: unknown;
  contains?: string;
  regex?: string;
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
}

export interface TaskExpect {
  tools: string[];
  forbid: string[];
  arguments: Record<string, Record<string, FieldCheck>>;
}

export type Verifier =
  | { type: "exact"; value: string; caseSensitive: boolean }
  | { type: "regex"; pattern: string; flags: string }
  | { type: "llm-judge"; criteria: string; model?: string };

export interface EvalTask {
  id: string;
  prompt: string;
  expect: TaskExpect;
  verifier: Verifier;
}

export function parseTasks(document: unknown, source = "tasks"): EvalTask[] {
  const list = taskList(document, source);
  const seen = new Set<string>();
  return list.map((item, index) => {
    const task = parseTask(item, `${source}[${index}]`);
    if (seen.has(task.id)) throw new UserError(`${source}[${index}].id "${task.id}" is duplicated.`);
    seen.add(task.id);
    return task;
  });
}

function taskList(document: unknown, source: string): unknown[] {
  if (Array.isArray(document)) return document;
  if (isRecord(document) && Array.isArray(document.tasks)) return document.tasks;
  throw new UserError(`${source} must be a list of tasks or an object with a tasks list.`);
}

function parseTask(value: unknown, path: string): EvalTask {
  if (!isRecord(value)) throw new UserError(`${path} must be an object.`);
  rejectUnknown(value, ["id", "prompt", "expect", "verifier"], path);
  const id = requiredString(value.id, `${path}.id`);
  if (!TASK_ID.test(id)) {
    throw new UserError(`${path}.id must start with a letter or digit and contain only letters, digits, "_" and "-".`);
  }
  const prompt = requiredString(value.prompt, `${path}.prompt`);
  if (prompt.trim() === "") throw new UserError(`${path}.prompt is empty.`);
  return {
    id,
    prompt,
    expect: parseExpect(value.expect, `${path}.expect`),
    verifier: parseVerifier(value.verifier, `${path}.verifier`),
  };
}

function parseExpect(value: unknown, path: string): TaskExpect {
  if (value === undefined) return { tools: [], forbid: [], arguments: {} };
  if (!isRecord(value)) throw new UserError(`${path} must be an object.`);
  rejectUnknown(value, ["tools", "forbid", "arguments"], path);
  return {
    tools: stringList(value.tools, `${path}.tools`),
    forbid: stringList(value.forbid, `${path}.forbid`),
    arguments: parseArgumentChecks(value.arguments, `${path}.arguments`),
  };
}

function parseArgumentChecks(value: unknown, path: string): Record<string, Record<string, FieldCheck>> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new UserError(`${path} must be an object keyed by tool name.`);
  const checks: Record<string, Record<string, FieldCheck>> = {};
  for (const [tool, fields] of Object.entries(value)) {
    if (!isRecord(fields)) throw new UserError(`${path}.${tool} must be an object keyed by argument name.`);
    const parsed: Record<string, FieldCheck> = {};
    for (const [field, check] of Object.entries(fields)) {
      parsed[field] = parseFieldCheck(check, `${path}.${tool}.${field}`);
    }
    checks[tool] = parsed;
  }
  return checks;
}

function parseFieldCheck(value: unknown, path: string): FieldCheck {
  if (!isRecord(value)) throw new UserError(`${path} must be an object with equals, contains, regex, or type.`);
  rejectUnknown(value, [...CHECK_KEYS], path);
  if (Object.keys(value).length === 0) throw new UserError(`${path} needs equals, contains, regex, or type.`);
  const check: FieldCheck = {};
  if ("equals" in value) check.equals = value.equals;
  if ("contains" in value) check.contains = requiredString(value.contains, `${path}.contains`);
  if ("regex" in value) {
    check.regex = requiredString(value.regex, `${path}.regex`);
    compileRegex(check.regex, "", `${path}.regex`);
  }
  if ("type" in value) {
    const type = requiredString(value.type, `${path}.type`);
    if (!TYPE_NAMES.has(type)) throw new UserError(`${path}.type must be one of ${[...TYPE_NAMES].join(", ")}.`);
    check.type = type as FieldCheck["type"];
  }
  return check;
}

function parseVerifier(value: unknown, path: string): Verifier {
  if (!isRecord(value)) throw new UserError(`${path} must be an object.`);
  const type = requiredString(value.type, `${path}.type`);
  if (type === "exact") {
    rejectUnknown(value, ["type", "value", "caseSensitive"], path);
    return {
      type,
      value: requiredString(value.value, `${path}.value`),
      caseSensitive: optionalBoolean(value.caseSensitive, `${path}.caseSensitive`) ?? false,
    };
  }
  if (type === "regex") {
    rejectUnknown(value, ["type", "pattern", "flags"], path);
    const pattern = requiredString(value.pattern, `${path}.pattern`);
    const flags = value.flags === undefined ? "" : requiredString(value.flags, `${path}.flags`);
    compileRegex(pattern, flags, path);
    return { type, pattern, flags };
  }
  if (type === "llm-judge") {
    rejectUnknown(value, ["type", "criteria", "model"], path);
    const criteria = requiredString(value.criteria, `${path}.criteria`);
    if (criteria.trim() === "") throw new UserError(`${path}.criteria is empty.`);
    const model = value.model === undefined ? undefined : requiredString(value.model, `${path}.model`);
    return model === undefined ? { type, criteria } : { type, criteria, model };
  }
  throw new UserError(`${path}.type must be exact, regex, or llm-judge.`);
}

function stringList(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new UserError(`${path} must be a list of tool names.`);
  }
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string") throw new UserError(`${path} must be a string.`);
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new UserError(`${path} must be a boolean.`);
  return value;
}

function rejectUnknown(value: Record<string, unknown>, allowed: string[], path: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new UserError(`${path} has unknown fields: ${extra.join(", ")}.`);
}

function compileRegex(pattern: string, flags: string, path: string): void {
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserError(`${path} is not a valid regular expression: ${message}`);
  }
}
