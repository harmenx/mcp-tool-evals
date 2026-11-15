import { readFile } from "node:fs/promises";
import { parse, stringify } from "yaml";
import type { LoadedConfig } from "./config.js";
import { UserError } from "./errors.js";
import { connectServer, type ListedTool } from "./mcp.js";
import type { ModelClient } from "./model.js";
import { parseTasks, type EvalTask } from "./tasks.js";
import { isRecord } from "./util.js";

const DRAFT_SYSTEM = "Draft eval tasks. Reply with one YAML document and no other text.";

export async function generateTasks(input: {
  config: LoadedConfig;
  count: number;
  model: string;
  client: ModelClient;
  signal?: AbortSignal;
}): Promise<EvalTask[]> {
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 20) {
    throw new UserError("--count must be an integer from 1 to 20.");
  }
  const session = await connectServer(input.config.server);
  try {
    const tools = await session.listTools();
    if (tools.length === 0) throw new UserError("The server did not list any tools to draft tasks from.");
    const response = await input.client.chat({
      model: input.model,
      messages: [
        { role: "system", content: DRAFT_SYSTEM },
        { role: "user", content: buildDraftPrompt(tools, input.count) },
      ],
      signal: input.signal,
    });
    return tasksFromDraft(response.content, tools);
  } finally {
    await session.close();
  }
}

export function buildDraftPrompt(tools: ListedTool[], count: number): string {
  const lines = [
    `Write ${count} tasks for this MCP server.`,
    "Reply with YAML only. Each task needs id, prompt, expect.tools, and verifier.",
    "Use verifier type llm-judge. expect.tools must name tools from the list below.",
    "Prompts should be questions a person would actually ask. Cover different tools.",
    "",
    "Shape:",
    "tasks:",
    "  - id: sample-task",
    "    prompt: What does the catalog say about Dune?",
    "    expect:",
    "      tools: [search_books]",
    "    verifier:",
    "      type: llm-judge",
    "      criteria: The answer states the price and whether the book is in stock.",
    "",
    "Tools:",
  ];
  for (const tool of tools) {
    lines.push(`- name: ${tool.name}`);
    if (tool.description) lines.push(`  description: ${tool.description}`);
    lines.push(`  inputSchema: ${JSON.stringify(tool.inputSchema)}`);
  }
  return lines.join("\n");
}

export function tasksFromDraft(text: string, tools: ListedTool[]): EvalTask[] {
  let document: unknown;
  try {
    document = parse(yamlBody(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UserError(`The model did not return YAML tasks: ${message}\n${text.slice(0, 500)}`);
  }
  let tasks: EvalTask[];
  try {
    tasks = parseTasks(document, "draft");
  } catch (error) {
    if (error instanceof UserError) {
      throw new UserError(`${error.message}\nDraft started: ${text.slice(0, 500)}`);
    }
    throw error;
  }
  const known = new Set(tools.map((tool) => tool.name));
  for (const task of tasks) {
    for (const name of [...task.expect.tools, ...task.expect.forbid]) {
      if (!known.has(name)) throw new UserError(`Draft task ${task.id} names unknown tool "${name}".`);
    }
  }
  if (tasks.length === 0) throw new UserError("The model returned no tasks.");
  return tasks;
}

export function renderTasks(tasks: EvalTask[]): string {
  const document = {
    tasks: tasks.map((task) => {
      const expect: Record<string, unknown> = {};
      if (task.expect.tools.length > 0) expect.tools = task.expect.tools;
      if (task.expect.forbid.length > 0) expect.forbid = task.expect.forbid;
      if (Object.keys(task.expect.arguments).length > 0) expect.arguments = task.expect.arguments;
      const verifier: Record<string, unknown> = { type: task.verifier.type };
      if (task.verifier.type === "exact") {
        verifier.value = task.verifier.value;
        if (task.verifier.caseSensitive) verifier.caseSensitive = true;
      } else if (task.verifier.type === "regex") {
        verifier.pattern = task.verifier.pattern;
        if (task.verifier.flags) verifier.flags = task.verifier.flags;
      } else {
        verifier.criteria = task.verifier.criteria;
        if (task.verifier.model) verifier.model = task.verifier.model;
      }
      return {
        id: task.id,
        prompt: task.prompt,
        ...(Object.keys(expect).length > 0 ? { expect } : {}),
        verifier,
      };
    }),
  };
  return `# Draft tasks. Review the prompts, expected tools, and verifiers before relying on them.\n${stringify(document)}`;
}

export async function readTasksFile(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function yamlBody(text: string): string {
  const fenced = text.match(/```(?:yaml|yml)?\s*([\s\S]*?)```/);
  return (fenced?.[1] ?? text).trim();
}
