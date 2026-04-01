import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { DifyClient } from "./dify.js";

/**
 * MCP Server – exposes READ-ONLY tools to the LLM.
 *
 * Tools:
 *   - list_workspaces        : list available Dify knowledge bases
 *   - query_workspace        : retrieve matched chunks from a knowledge base
 *   - list_workspace_docs    : list documents in a knowledge base
 *
 * No write/mutate tools are registered here intentionally.
 */
export async function startMcpServer(client: DifyClient): Promise<void> {
  const server = new McpServer({
    name: "xinjin-dify-rag",
    version: "1.0.0",
  });

  // ----------------------------------------------------------------
  // Tool: list_workspaces
  // ----------------------------------------------------------------
  server.tool(
    "list_workspaces",
    "List all available Dify knowledge bases. The returned slug is the dataset UUID.",
    {},
    async () => {
      const workspaces = await client.listWorkspaces();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(workspaces, null, 2),
          },
        ],
      };
    }
  );

  // ----------------------------------------------------------------
  // Tool: query_workspace
  // ----------------------------------------------------------------
  server.tool(
    "query_workspace",
    "Retrieve matched chunks from a Dify knowledge base without LLM summarization. " +
      "The knowledge base's retrieval settings decide how many chunks Dify returns; topN slices the returned list locally.",
    {
      slug: z
        .string()
        .describe(
          "The knowledge base slug or dataset UUID to query. Use list_workspaces to discover valid values."
        ),
      message: z.string().describe("The retrieval query to send to the knowledge base."),
      topN: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(4)
        .describe("Maximum number of raw vector matches to return."),
    },
    async ({ slug, message, topN }) => {
      const response = await client.rawVectorSearch(slug, message, topN);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
  );

  // ----------------------------------------------------------------
  // Tool: list_workspace_docs
  // ----------------------------------------------------------------
  server.tool(
    "list_workspace_docs",
    "List the documents currently stored in a Dify knowledge base.",
    {
      slug: z
        .string()
        .describe(
          "The knowledge base slug or dataset UUID. Use list_workspaces to discover valid values."
        ),
    },
    async ({ slug }) => {
      const docs = await client.listWorkspaceDocuments(slug);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(docs, null, 2),
          },
        ],
      };
    }
  );

  // ----------------------------------------------------------------
  // Connect via stdio (standard MCP transport)
  // ----------------------------------------------------------------
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
