import { describe, expect, it } from "vitest";
import path from "node:path";
import { connectServer } from "../src/mcp.js";
import { repoRoot, startBookstoreHttp } from "./helpers.js";

describe("MCP connection", () => {
  it("lists and calls tools over stdio", async () => {
    const session = await connectServer({
      transport: "stdio",
      command: process.execPath,
      args: ["--import", "tsx", path.join(repoRoot, "examples/bookstore/server.ts")],
      cwd: repoRoot,
    });
    try {
      const tools = await session.listTools();
      expect(tools.map((tool) => tool.name)).toEqual(["search_books", "get_book", "list_by_tag", "calculate"]);
      expect(session.serverName).toBe("bookstore");
      const result = await session.callTool("calculate", { op: "mul", a: 15, b: 4 }, 5000);
      expect(result).toEqual({ text: "60", isError: false });
    } finally {
      await session.close();
    }
  });

  it("lists and calls tools over streamable HTTP", async () => {
    const server = await startBookstoreHttp();
    try {
      const session = await connectServer({ transport: "http", url: `http://127.0.0.1:${server.port}/mcp` });
      try {
        const tools = await session.listTools();
        expect(tools.map((tool) => tool.name)).toContain("search_books");
        const result = await session.callTool("search_books", { query: "Dune" }, 5000);
        expect(result.isError).toBe(false);
        expect(result.text).toContain("9.99");
        expect(result.text).toContain("in stock");
      } finally {
        await session.close();
      }
    } finally {
      await server.stop();
    }
  });
});
