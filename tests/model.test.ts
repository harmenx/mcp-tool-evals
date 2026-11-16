import { describe, expect, it } from "vitest";
import { mockChat } from "../examples/mock-openai/respond.js";
import { startMockServer } from "../examples/mock-openai/server.js";
import { createOpenAIClient, parseCompletion, resolveChatUrl } from "../src/model.js";

describe("model client", () => {
  it("joins the chat completions path onto a base URL", () => {
    expect(resolveChatUrl("http://127.0.0.1:8787/v1")).toBe("http://127.0.0.1:8787/v1/chat/completions");
    expect(resolveChatUrl("http://127.0.0.1:8787/v1/")).toBe("http://127.0.0.1:8787/v1/chat/completions");
  });

  it("reads a tool call from the mock payload", () => {
    const response = parseCompletion(
      mockChat({ model: "mock-good", messages: [{ role: "user", content: "What is 15 multiplied by 4?" }] }),
    );
    expect(response.toolCalls[0]).toMatchObject({ name: "calculate", argumentsText: '{"op":"mul","a":15,"b":4}' });
    expect(response.promptTokens).toBeGreaterThan(0);
  });

  it("posts to the mock server and grades a quoted answer", async () => {
    const server = await startMockServer(0);
    try {
      const client = createOpenAIClient({ baseUrl: server.url, apiKey: "test" });
      const drafted = await client.chat({
        model: "mock-good",
        messages: [
          { role: "system", content: "Grade the answer." },
          { role: "user", content: 'Criteria:\ninclude "9.99"\n\nAnswer:\nThe price is 9.99' },
        ],
      });
      expect(JSON.parse(drafted.content)).toMatchObject({ pass: true });
    } finally {
      await server.close();
    }
  });
});