import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import OpenAI from "openai";
import path from "node:path";

let _client: Client | null = null;
let _connecting: Promise<Client> | null = null;

const hasMcpConfig = (): boolean =>
  Boolean(process.env.MCP_SERVER_CMD && process.env.MCP_SERVER_CMD.trim().length > 0);

async function connectMcpClient(): Promise<Client> {
  const cmd = process.env.MCP_SERVER_CMD!.trim();
  const parts = cmd.split(/\s+/);
  const cwd = process.env.MCP_SERVER_CWD?.trim();
  const transport = new StdioClientTransport({
    command: parts[0],
    args: parts.slice(1),
    ...(cwd ? { cwd: path.isAbsolute(cwd) ? cwd : path.resolve(process.cwd(), cwd) } : {})
  });
  const client = new Client({ name: "xinjin-backend", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

export async function getMcpClient(): Promise<Client | null> {
  if (!hasMcpConfig()) return null;
  if (_client) return _client;
  if (_connecting) return _connecting;
  _connecting = connectMcpClient().then((c) => {
    _client = c;
    _connecting = null;
    return c;
  });
  return _connecting;
}

export async function listMcpTools(): Promise<OpenAI.Chat.ChatCompletionTool[]> {
  const client = await getMcpClient();
  if (!client) return [];
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description || "",
        parameters: (t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} }
      }
    }));
  } catch {
    return [];
  }
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  const client = await getMcpClient();
  if (!client) throw new Error("MCP client not available");
  const result = await client.callTool({ name, arguments: args });
  const content = result.content;
  if (Array.isArray(content)) {
    return content
      .map((c: unknown) => {
        const item = c as { type?: string; text?: string };
        return item.type === "text" ? (item.text ?? "") : JSON.stringify(c);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}
