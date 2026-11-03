import { describe, expect, it } from "vitest";
import { UserError } from "../src/errors.js";
import { parseTasks } from "../src/tasks.js";

describe("parseTasks", () => {
  it("reads a tasks list and fills defaults", () => {
    const tasks = parseTasks({
      tasks: [
        {
          id: "price",
          prompt: "How much is Dune?",
          expect: { tools: ["search_books"], arguments: { search_books: { query: { contains: "Dune" } } } },
          verifier: { type: "regex", pattern: "9\\.99", flags: "i" },
        },
      ],
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.expect.forbid).toEqual([]);
    expect(tasks[0]?.verifier).toEqual({ type: "regex", pattern: "9\\.99", flags: "i" });
  });

  it("accepts a bare list and an exact verifier", () => {
    const tasks = parseTasks([{ id: "sum", prompt: "1+1", verifier: { type: "exact", value: "2" } }]);
    expect(tasks[0]?.verifier).toEqual({ type: "exact", value: "2", caseSensitive: false });
    expect(tasks[0]?.expect.tools).toEqual([]);
  });

  it("rejects a bad id, a duplicate, an unknown field, and a broken pattern", () => {
    expect(() => parseTasks([{ id: "has space", prompt: "x", verifier: { type: "exact", value: "y" } }])).toThrow(UserError);
    expect(() =>
      parseTasks([
        { id: "a", prompt: "x", verifier: { type: "exact", value: "y" } },
        { id: "a", prompt: "z", verifier: { type: "exact", value: "y" } },
      ]),
    ).toThrow(/duplicated/);
    expect(() => parseTasks([{ id: "a", prompt: "x", verifier: { type: "exact", value: "y", extra: true } }])).toThrow(/unknown/);
    expect(() => parseTasks([{ id: "a", prompt: "x", verifier: { type: "regex", pattern: "(" } }])).toThrow(/regular expression/);
  });
});
