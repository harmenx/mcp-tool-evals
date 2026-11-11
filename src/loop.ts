import { checkToolArguments, parametersFor, type ListedTool, type McpSession } from "./mcp.js";
import type { ChatMessage, ModelClient, OpenAITool } from "./model.js";
import type { EvalTask, FieldCheck } from "./tasks.js";
import type { TaskRun, ToolCallRecord } from "./types.js";
import { deepEqual, isRecord, truncate } from "./util.js";

const SYSTEM_PROMPT = [
  "Answer the user. Call a tool when it is needed, using only the tools you were given.",
  "When you have what you need, reply with the final answer and do not call another tool.",
].join(" ");

export async function runTaskLoop(input: {
  task: EvalTask;
  tools: ListedTool[];
  session: McpSession;
  client: ModelClient;
  model: string;
  maxTurns: number;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<TaskRun> {
  const started = Date.now();
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input.task.prompt },
  ];
  const tools = toOpenAITools(input.tools);
  const toolCalls: ToolCallRecord[] = [];
  let promptTokens = 0;
  let completionTokens = 0;

  for (let turn = 0; turn < input.maxTurns; turn += 1) {
    const signal = combineSignals(input.signal, input.timeoutMs);
    const response = await input.client.chat({
      model: input.model,
      messages,
      tools,
      signal,
    });
    promptTokens += response.promptTokens;
    completionTokens += response.completionTokens;

    if (response.toolCalls.length === 0) {
      return {
        finalAnswer: response.content,
        toolCalls,
        promptTokens,
        completionTokens,
        latencyMs: Date.now() - started,
        stoppedEarly: false,
      };
    }

    messages.push({
      role: "assistant",
      content: response.content === "" ? null : response.content,
      tool_calls: response.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: call.argumentsText },
      })),
    });

    for (const call of response.toolCalls) {
      const record = await executeCall(call, input);
      toolCalls.push(record);
      messages.push({ role: "tool", tool_call_id: call.id, content: record.resultPreview });
    }
  }

  return {
    finalAnswer: "",
    toolCalls,
    promptTokens,
    completionTokens,
    latencyMs: Date.now() - started,
    stoppedEarly: true,
  };
}

function toOpenAITools(tools: ListedTool[]): OpenAITool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: parametersFor(tool.inputSchema),
    },
  }));
}

async function executeCall(
  call: { id: string; name: string; argumentsText: string },
  input: { tools: ListedTool[]; session: McpSession; task: EvalTask; timeoutMs: number },
): Promise<ToolCallRecord> {
  const tool = input.tools.find((candidate) => candidate.name === call.name);
  const parsed = parseArguments(call.argumentsText);
  const schema = parsed.ok ? checkToolArguments(tool, parsed.value) : { valid: false, detail: parsed.error };
  const checks = parsed.ok ? checkFieldConstraints(call.name, parsed.value, input.task) : { valid: false, detail: "arguments were not JSON" };
  let result = { text: schema.detail || checks.detail || "Tool call was not sent.", isError: true };

  if (parsed.ok && tool && schema.valid) {
    const args = isRecord(parsed.value) ? parsed.value : {};
    result = await input.session.callTool(call.name, args, input.timeoutMs);
  } else if (parsed.ok && !tool) {
    result = { text: `Unknown tool "${call.name}".`, isError: true };
  } else if (parsed.ok && !schema.valid) {
    result = { text: `Invalid arguments for ${call.name}: ${schema.detail}`, isError: true };
  }

  return {
    name: call.name,
    arguments: parsed.ok ? parsed.value : call.argumentsText,
    argumentsText: call.argumentsText,
    schemaValid: schema.valid,
    checksValid: checks.valid,
    valid: schema.valid && checks.valid,
    isError: result.isError,
    resultPreview: truncate(result.text, 2000),
  };
}

function parseArguments(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, error: "arguments were not valid JSON" };
  }
}

function checkFieldConstraints(
  toolName: string,
  args: unknown,
  task: EvalTask,
): { valid: boolean; detail: string } {
  const checks = task.expect.arguments[toolName];
  if (!checks) return { valid: true, detail: "" };
  if (!isRecord(args)) return { valid: false, detail: "arguments were not an object" };
  const problems: string[] = [];
  for (const [field, check] of Object.entries(checks)) {
    const problem = mismatch(field, args[field], check);
    if (problem) problems.push(problem);
  }
  return problems.length === 0 ? { valid: true, detail: "" } : { valid: false, detail: problems.join("; ") };
}

function mismatch(field: string, value: unknown, check: FieldCheck): string | undefined {
  if (check.equals !== undefined && !deepEqual(value, check.equals)) {
    return `${field} expected ${JSON.stringify(check.equals)}`;
  }
  if (check.contains !== undefined) {
    const haystack = typeof value === "string" ? value : JSON.stringify(value);
    if (!haystack.includes(check.contains)) return `${field} does not contain ${JSON.stringify(check.contains)}`;
  }
  if (check.regex !== undefined) {
    if (typeof value !== "string" || !new RegExp(check.regex).test(value)) {
      return `${field} does not match /${check.regex}/`;
    }
  }
  if (check.type !== undefined && !valueHasType(value, check.type)) {
    return `${field} expected type ${check.type}`;
  }
  return undefined;
}

function valueHasType(value: unknown, type: NonNullable<FieldCheck["type"]>): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    default:
      return false;
  }
}

function combineSignals(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}
