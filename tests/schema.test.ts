import { describe, expect, it } from "vitest";
import { validateJsonSchema } from "../src/schema.js";

const search = {
  type: "object",
  properties: { query: { type: "string", minLength: 1 } },
  required: ["query"],
};

const calculate = {
  type: "object",
  properties: {
    op: { type: "string", enum: ["add", "mul"] },
    a: { type: "number" },
    b: { type: "number" },
  },
  required: ["op", "a", "b"],
  additionalProperties: false,
};

describe("validateJsonSchema", () => {
  it("accepts arguments that match a tool schema", () => {
    expect(validateJsonSchema(search, { query: "Dune" })).toEqual([]);
    expect(validateJsonSchema(calculate, { op: "mul", a: 15, b: 4 })).toEqual([]);
  });

  it("rejects the wrong type, a missing field, an enum miss, and extra properties", () => {
    expect(validateJsonSchema(search, { query: 1 }).map((issue) => issue.path)).toEqual(["$.query"]);
    expect(validateJsonSchema(search, {}).some((issue) => issue.message === "is required")).toBe(true);
    expect(validateJsonSchema(search, { query: "" }).some((issue) => issue.message.includes("at least"))).toBe(true);
    expect(validateJsonSchema(calculate, { op: "div", a: 1, b: 2 }).length).toBeGreaterThan(0);
    expect(validateJsonSchema(calculate, { op: "add", a: "x", b: 1 }).some((issue) => issue.path === "$.a")).toBe(true);
    expect(validateJsonSchema(calculate, { op: "add", a: 1, b: 2, extra: true }).some((issue) => issue.path === "$.extra")).toBe(
      true,
    );
  });

  it("checks array items and numeric bounds", () => {
    const schema = {
      type: "array",
      minItems: 1,
      items: { type: "integer", minimum: 0, maximum: 2 },
    };
    expect(validateJsonSchema(schema, [0, 2])).toEqual([]);
    expect(validateJsonSchema(schema, []).length).toBeGreaterThan(0);
    expect(validateJsonSchema(schema, [3]).length).toBeGreaterThan(0);
    expect(validateJsonSchema(schema, [1.5]).length).toBeGreaterThan(0);
  });
});
