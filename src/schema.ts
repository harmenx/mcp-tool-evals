import { isRecord } from "./util.js";

export interface SchemaIssue {
  path: string;
  message: string;
}

const PRIMITIVE_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

function matchesType(value: unknown, type: string): boolean {
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
    case "null":
      return value === null;
    default:
      return true;
  }
}

function typeNames(schema: Record<string, unknown>): string[] | undefined {
  const declared = schema.type;
  if (typeof declared === "string") return [declared];
  if (Array.isArray(declared) && declared.every((item) => typeof item === "string")) return declared;
  return undefined;
}

/**
 * Check a value against the subset of JSON Schema that MCP tool inputs use:
 * type, enum, const, required, properties, additionalProperties, items, and
 * the common string and number bounds.
 */
export function validateJsonSchema(schema: unknown, value: unknown, path = "$"): SchemaIssue[] {
  if (!isRecord(schema)) return [];
  const issues: SchemaIssue[] = [];

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => sameJson(candidate, value))) {
    issues.push({ path, message: `expected one of ${schema.enum.map((item) => JSON.stringify(item)).join(", ")}` });
  }

  if ("const" in schema && !sameJson(schema.const, value)) {
    issues.push({ path, message: `expected ${JSON.stringify(schema.const)}` });
  }

  const types = typeNames(schema)?.filter((type) => PRIMITIVE_TYPES.has(type));
  if (types && types.length > 0 && !types.some((type) => matchesType(value, type))) {
    issues.push({ path, message: `expected ${types.join(" or ")}, received ${describe(value)}` });
    return issues;
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      issues.push({ path, message: `expected at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      issues.push({ path, message: `expected at most ${schema.maxLength} characters` });
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({ path, message: `expected a number >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push({ path, message: `expected a number <= ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      issues.push({ path, message: `expected a number > ${schema.exclusiveMinimum}` });
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      issues.push({ path, message: `expected a number < ${schema.exclusiveMaximum}` });
    }
  }

  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : undefined;
    const required = Array.isArray(schema.required) ? schema.required.filter((item) => typeof item === "string") : [];
    for (const key of required) {
      if (!(key in value)) issues.push({ path: joinPath(path, key), message: "is required" });
    }
    if (properties) {
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in value) issues.push(...validateJsonSchema(propertySchema, value[key], joinPath(path, key)));
      }
    }
    if (schema.additionalProperties === false && properties) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) issues.push({ path: joinPath(path, key), message: "is not allowed" });
      }
    } else if (isRecord(schema.additionalProperties)) {
      for (const [key, property] of Object.entries(value)) {
        if (!properties || !(key in properties)) {
          issues.push(...validateJsonSchema(schema.additionalProperties, property, joinPath(path, key)));
        }
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      issues.push({ path, message: `expected at least ${schema.minItems} items` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      issues.push({ path, message: `expected at most ${schema.maxItems} items` });
    }
    if ("items" in schema) {
      value.forEach((item, index) => {
        issues.push(...validateJsonSchema(schema.items, item, `${path}[${index}]`));
      });
    }
  }

  return issues;
}

export function schemaErrors(issues: SchemaIssue[]): string {
  return issues.map((issue) => `${issue.path} ${issue.message}`).join("; ");
}

function joinPath(parent: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isNaN(value)) return "NaN";
  return typeof value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
