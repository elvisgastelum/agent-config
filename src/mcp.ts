// A minimal MCP server over stdio (newline-delimited JSON-RPC 2.0), tools only.

import { createInterface } from "node:readline";

/** Protocol versions this server speaks, newest first. */
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/** The JSON Schema subset `validate` understands. */
export type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  items?: JsonSchema;
  minLength?: number;
  minimum?: number;
  description?: string;
};

export type McpTool = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  handler(args: Record<string, unknown>): unknown;
};

export type McpOptions = {
  name: string;
  version: string;
  instructions?: string;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

/** Whether `value` is of JSON type `type` (an integer is also a number). */
const matchesType = (value: unknown, type: string): boolean =>
  typeOf(value) === type || (type === "number" && typeOf(value) === "integer");

/** Returns the first problem found with `value` against `schema`, or null; `path` names the field. */
export function validate(value: unknown, schema: JsonSchema, path: string): string | null {
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      return `${path} must be of type ${types.join(" or ")}`;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    return `${path} must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  }
  if (typeof value === "string" && schema.minLength !== undefined) {
    if (value.length < schema.minLength)
      return `${path} must be at least ${schema.minLength} characters`;
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) {
    return `${path} must be at least ${schema.minimum}`;
  }
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      const problem = validate(item, schema.items, `${path}[${index}]`);
      if (problem) return problem;
    }
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) return `${path}.${key} is required`;
    }
    for (const [key, item] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (child) {
        const problem = validate(item, child, `${path}.${key}`);
        if (problem) return problem;
      } else if (schema.additionalProperties === false) {
        return `${path}.${key} is not an allowed property`;
      }
    }
  }
  return null;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Serves `tools` until `options.input` ends. Only JSON-RPC replies are written to `output`. */
export async function serveMcp(tools: McpTool[], options: McpOptions): Promise<void> {
  const send = (id: unknown, body: { result: unknown } | { error: object }): void => {
    options.output.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...body })}\n`);
  };
  const fail = (id: unknown, code: number, text: string): void =>
    send(id, { error: { code, message: text } });

  async function callTool(id: unknown, params: unknown): Promise<void> {
    const name = isObject(params) ? params.name : undefined;
    const tool = tools.find((t) => t.name === name);
    if (!tool) return fail(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`);
    const args = isObject(params) && params.arguments !== undefined ? params.arguments : {};
    try {
      const problem = validate(args, tool.inputSchema, "arguments");
      if (problem) throw new Error(problem);
      const result = await tool.handler(args as Record<string, unknown>);
      send(id, {
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
          isError: false,
        },
      });
    } catch (error) {
      send(id, { result: { content: [{ type: "text", text: message(error) }], isError: true } });
    }
  }

  async function handle(line: string): Promise<void> {
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      return fail(null, PARSE_ERROR, "Parse error");
    }
    if (!isObject(request) || typeof request.method !== "string") {
      return fail(null, INVALID_REQUEST, "Invalid request");
    }
    if (!("id" in request)) return;
    const { id, method, params } = request;
    switch (method) {
      case "initialize": {
        const asked = isObject(params) ? params.protocolVersion : undefined;
        const protocolVersion =
          SUPPORTED_VERSIONS.find((v) => v === asked) ?? SUPPORTED_VERSIONS[0];
        return send(id, {
          result: {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: options.name, version: options.version },
            ...(options.instructions ? { instructions: options.instructions } : {}),
          },
        });
      }
      case "ping":
        return send(id, { result: {} });
      case "tools/list":
        return send(id, {
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
              annotations: { readOnlyHint: t.readOnly },
            })),
          },
        });
      case "tools/call":
        return callTool(id, params);
      default:
        return fail(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  const lines = createInterface({ input: options.input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() !== "") await handle(line);
  }
}
