import { stringify } from "yaml";

export interface MockMessage {
  role?: string;
  content?: string | null;
  tool_call_id?: string;
}

export interface MockRequest {
  model?: string;
  messages?: MockMessage[];
  tools?: unknown[];
}

interface ToolPlan {
  name: string;
  args: Record<string, unknown>;
}

/** Deterministic stand-in for an OpenAI-compatible chat endpoint. */
export function mockChat(request: MockRequest): Record<string, unknown> {
  const messages = request.messages ?? [];
  const blob = messages.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  const model = request.model ?? "mock-good";

  if (blob.includes("Grade the answer.")) return completion(model, judge(blob), messages);
  if (blob.includes("Draft eval tasks.")) return completion(model, draft(blob), messages);

  const toolText = lastToolText(messages);
  if (toolText !== undefined) return completion(model, finish(toolText), messages);

  const plan = model === "mock-wrong-tool" ? wrongTool(request) : planFromPrompt(blob);
  if (!plan) return completion(model, "I don't know.", messages);
  const args = model === "mock-bad-args" ? corrupt(plan) : plan.args;
  return toolCall(model, plan.name, args, messages);
}

function planFromPrompt(prompt: string): ToolPlan | null {
  const id = prompt.match(/book id\s+([a-z0-9-]+)/i);
  if (id?.[1]) return { name: "get_book", args: { id: id[1].toLowerCase() } };
  const multiplied = prompt.match(/(\d+(?:\.\d+)?)\s+multiplied by\s+(\d+(?:\.\d+)?)/i);
  if (multiplied?.[1] && multiplied[2]) {
    return { name: "calculate", args: { op: "mul", a: Number(multiplied[1]), b: Number(multiplied[2]) } };
  }
  if (/\bsci-fi\b/i.test(prompt)) return { name: "list_by_tag", args: { tag: "sci-fi" } };
  if (/neuromancer/i.test(prompt)) return { name: "search_books", args: { query: "Neuromancer" } };
  if (/\bdune\b/i.test(prompt)) return { name: "search_books", args: { query: "Dune" } };
  return null;
}

function wrongTool(request: MockRequest): ToolPlan {
  const names = toolNames(request);
  if (names.length === 0 || names.includes("calculate")) {
    return { name: "calculate", args: { op: "add", a: 1, b: 1 } };
  }
  return { name: names[0] ?? "calculate", args: {} };
}

function corrupt(plan: ToolPlan): Record<string, unknown> {
  if (plan.name === "calculate") return { op: "div", a: "x", b: "y" };
  if (plan.name === "get_book") return { id: false };
  if (plan.name === "list_by_tag") return { tag: 1 };
  return { query: 1 };
}

function finish(toolText: string): string {
  const trimmed = toolText.trim();
  return /^-?\d+(\.\d+)?$/.test(trimmed) ? trimmed : trimmed;
}

function judge(blob: string): string {
  const criteria = blob.split("Criteria:")[1]?.split("Answer:")[0] ?? "";
  const answer = blob.split("Answer:").slice(1).join("Answer:");
  const quotes = [...criteria.matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
  const haystack = answer.toLowerCase();
  const pass = quotes.length > 0 && quotes.every((quote) => haystack.includes(quote.toLowerCase()));
  return JSON.stringify({
    pass,
    reason: pass ? "The answer includes the required text." : "The answer is missing required text.",
  });
}

function draft(blob: string): string {
  const count = Number(blob.match(/Write (\d+) tasks/)?.[1] ?? 2);
  const names = [...blob.matchAll(/^- name: ([A-Za-z0-9_-]+)/gm)].map((match) => match[1] ?? "");
  const unique = [...new Set(names.filter((name) => name !== ""))];
  const picked = unique.slice(0, Math.max(1, count));
  const tasks = picked.map((name) => ({
    id: `draft-${name}`,
    prompt: `Use the ${name} tool to answer a realistic question about its result.`,
    expect: { tools: [name] },
    verifier: {
      type: "llm-judge",
      criteria: `The answer should reflect output from "${name}".`,
    },
  }));
  return stringify({ tasks });
}

function lastToolText(messages: MockMessage[]): string | undefined {
  const toolMessages = messages.filter((message) => message.role === "tool");
  const last = toolMessages.at(-1);
  if (!last) return undefined;
  return typeof last.content === "string" ? last.content : "";
}

function toolNames(request: MockRequest): string[] {
  if (!Array.isArray(request.tools)) return [];
  const names: string[] = [];
  for (const tool of request.tools) {
    if (!tool || typeof tool !== "object" || !("function" in tool)) continue;
    const fn = tool.function;
    if (fn && typeof fn === "object" && "name" in fn && typeof fn.name === "string") names.push(fn.name);
  }
  return names;
}

function completion(model: string, content: string, messages: MockMessage[]): Record<string, unknown> {
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
    usage: usage(messages, content),
  };
}

function toolCall(model: string, name: string, args: Record<string, unknown>, messages: MockMessage[]): Record<string, unknown> {
  const argumentsText = JSON.stringify(args);
  return {
    id: "chatcmpl-mock",
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: argumentsText } }],
        },
      },
    ],
    usage: usage(messages, argumentsText),
  };
}

function usage(messages: MockMessage[], completionText: string): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  const promptTokens = Math.max(1, Math.ceil(JSON.stringify(messages).length / 4));
  const completionTokens = Math.max(1, Math.ceil(completionText.length / 4));
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens };
}
