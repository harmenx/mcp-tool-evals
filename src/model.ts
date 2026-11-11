import { isRecord } from "./util.js";

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: OpenAITool[];
  signal?: AbortSignal;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  argumentsText: string;
}

export interface ChatResponse {
  content: string;
  toolCalls: ParsedToolCall[];
  promptTokens: number;
  completionTokens: number;
}

export interface ModelClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export function createOpenAIClient(options: { baseUrl: string; apiKey: string }): ModelClient {
  const endpoint = resolveChatUrl(options.baseUrl);
  return {
    async chat(request) {
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages,
        temperature: 0,
      };
      if (request.tools && request.tools.length > 0) {
        body.tools = request.tools;
        body.tool_choice = "auto";
      }
      let response: Response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Model request to ${endpoint} failed: ${message}`, { cause: error });
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Model request failed (${response.status}) from ${endpoint}: ${text.slice(0, 500)}`);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error(`Model response was not JSON: ${text.slice(0, 500)}`);
      }
      return parseCompletion(payload);
    },
  };
}

export function resolveChatUrl(baseUrl: string): string {
  const withSlash = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL("chat/completions", withSlash).href;
}

export function parseCompletion(payload: unknown): ChatResponse {
  if (!isRecord(payload)) throw new Error("Model response was not a JSON object.");
  if (payload.error !== undefined) {
    const message = isRecord(payload.error) ? String(payload.error.message ?? payload.error) : String(payload.error);
    throw new Error(`Model error: ${message}`);
  }
  if (!Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new Error("Model response did not include any choices.");
  }
  const choice = payload.choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) throw new Error("Model response choice had no message.");
  const usage = isRecord(payload.usage) ? payload.usage : {};
  return {
    content: readText(choice.message.content),
    toolCalls: readToolCalls(choice.message.tool_calls),
    promptTokens: numberOrZero(usage.prompt_tokens),
    completionTokens: numberOrZero(usage.completion_tokens),
  };
}

function readToolCalls(value: unknown): ParsedToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.map((call, index) => {
    if (!isRecord(call)) throw new Error(`Tool call ${index} was not an object.`);
    const fn = isRecord(call.function) ? call.function : undefined;
    const name = fn && typeof fn.name === "string" ? fn.name : "";
    if (!name) throw new Error(`Tool call ${index} did not include a function name.`);
    const id = typeof call.id === "string" && call.id !== "" ? call.id : `call_${index}`;
    const raw = fn?.arguments;
    const argumentsText = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
    return { id, name, argumentsText };
  });
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part) && typeof part.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return String(value);
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
