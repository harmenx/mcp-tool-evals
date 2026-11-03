import { UserError } from "./errors.js";

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => deepEqual(left[key], right[key]));
  }
  return false;
}

/** Replace `${VAR}` and `${VAR:-fallback}` using the process environment. */
export function interpolate(input: string, env: NodeJS.ProcessEnv = process.env): string {
  return input.replace(ENV_PATTERN, (full, name: string, fallback: string | undefined) => {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
    if (fallback !== undefined) return fallback;
    throw new UserError(`Environment variable ${name} is not set (${full}).`);
  });
}

export function interpolateValue(value: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof value === "string") return interpolate(value, env);
  if (Array.isArray(value)) return value.map((item) => interpolateValue(item, env));
  if (isRecord(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) next[key] = interpolateValue(item, env);
    return next;
  }
  return value;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3))}...`;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
