// Official MCP TypeScript SDK. The client and server packages are the current
// release line; they replace the older single package @modelcontextprotocol/sdk.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { UserError } from "./errors.js";
import { schemaErrors, validateJsonSchema } from "./schema.js";
import type { ServerConfig } from "./config.js";
import { isRecord, truncate, withTimeout } from "./util.js";

export interface ListedTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

export interface McpSession {
  serverName?: string;
  serverVersion?: string;
  listTools(): Promise<ListedTool[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<ToolResult>;
  close(): Promise<void>;
}

export async function connectServer(server: ServerConfig, options?: { verbose?: boolean }): Promise<McpSession> {
  const client = new Client({ name: "mcp-tool-evals", version: "0.1.0" });
  const stderrLines: string[] = [];
  const transport =
    server.transport === "stdio"
      ? new StdioClientTransport({
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          env: { ...getDefaultEnvironment(), ...server.env },
          stderr: "pipe",
        })
      : new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: server.headers ? { headers: server.headers } : undefined,
        });

  if (transport instanceof StdioClientTransport && transport.stderr) {
    transport.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderrLines.push(text);
      if (options?.verbose) process.stderr.write(text);
    });
  }

  try {
    await client.connect(transport);
  } catch (error) {
    const detail = stderrLines.join("").trim();
    const message = error instanceof Error ? error.message : String(error);
    const suffix = detail ? `\n${truncate(detail, 2000)}` : "";
    throw new UserError(`Could not connect to the MCP server: ${message}${suffix}`);
  }

  const info = client.getServerVersion();
  return {
    serverName: info?.name,
    serverVersion: info?.version,
    async listTools() {
      const listed = await client.listTools();
      return listed.tools.map((tool) => {
        const description = tool.description;
        const listedTool: ListedTool = { name: tool.name, inputSchema: asSchema(tool.inputSchema) };
        if (description) listedTool.description = description;
        return listedTool;
      });
    },
    async callTool(name, args, timeoutMs) {
      try {
        const result = await withTimeout(
          client.callTool({ name, arguments: args }),
          timeoutMs,
          `Tool ${name} timed out after ${timeoutMs}ms.`,
        );
        return { text: contentToText(result.content), isError: result.isError === true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { text: message, isError: true };
      }
    },
    async close() {
      await client.close();
    },
  };
}

export function checkToolArguments(
  tool: ListedTool | undefined,
  args: unknown,
): { valid: boolean; detail: string } {
  if (!tool) return { valid: false, detail: "unknown tool" };
  const issues = validateJsonSchema(tool.inputSchema, args ?? {});
  if (issues.length === 0) return { valid: true, detail: "" };
  return { valid: false, detail: schemaErrors(issues) };
}

export function parametersFor(schema: Record<string, unknown>): Record<string, unknown> {
  if (typeof schema.type === "string") return schema;
  return { type: "object", ...schema };
}

function asSchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { type: "object", properties: {} };
  return value;
}

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!isRecord(block)) return "";
      if (block.type === "text" && typeof block.text === "string") return block.text;
      return `[${typeof block.type === "string" ? block.type : "content"}]`;
    })
    .filter((part) => part !== "")
    .join("\n");
}
