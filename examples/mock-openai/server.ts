import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { mockChat, type MockRequest } from "./respond.js";

export interface MockServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

/**
 * OpenAI-compatible endpoint backed by {@link mockChat}.
 *
 * Model ids:
 * - `mock-good` (and any other name) calls the tool the prompt asks for
 * - `mock-wrong-tool` always calls `calculate`
 * - `mock-bad-args` calls the right tool with arguments that fail its schema
 */
export function startMockServer(port = 0): Promise<MockServer> {
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = address && typeof address === "object" ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${bound}/v1`,
        port: bound,
        close: () => new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  if (req.method !== "POST" || !pathname.endsWith("/chat/completions")) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "Not found" } }));
    return;
  }
  try {
    const text = await readBody(req);
    const body = JSON.parse(text) as MockRequest;
    const payload = mockChat(body);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message } }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const port = Number(process.env.PORT ?? 8787);
  const running = await startMockServer(port);
  console.error(`mock model listening on ${running.url}`);
}
