import "@fastify/multipart";
import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { DifyClient } from "./dify.js";
import { z } from "zod";

// ----------------------------------------------------------------
// Simple API-key guard for admin endpoints.
// Set ADMIN_API_KEY in .env; requests must send:
//   Authorization: Bearer <ADMIN_API_KEY>
// ----------------------------------------------------------------
async function adminGuard(req: FastifyRequest, reply: FastifyReply) {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) {
    return reply.code(503).send({ error: "Admin API not configured (ADMIN_API_KEY not set)" });
  }
  const auth = req.headers["authorization"] ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== adminKey) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function adminRoutes(app: FastifyInstance, client: DifyClient) {
  const resolveWorkspace = (workspaceSlug?: string): string => {
    const value = workspaceSlug ?? client.defaultDataset;
    if (!value) {
      throw new Error(
        "workspaceSlug is required for Dify document ingestion unless DIFY_DEFAULT_DATASET_ID is configured."
      );
    }
    return value;
  };

  // ----------------------------------------------------------------
  // Knowledge base management
  // ----------------------------------------------------------------

  app.get("/admin/workspaces", { preHandler: adminGuard }, async (_req, reply) => {
    const workspaces = await client.listWorkspaces();
    return reply.send({ workspaces });
  });

  app.post("/admin/workspaces", { preHandler: adminGuard }, async (req, reply) => {
    const body = z.object({ name: z.string().min(1) }).parse(req.body);
    const workspace = await client.createWorkspace(body.name);
    return reply.code(201).send({ workspace });
  });

  app.delete("/admin/workspaces/:slug", { preHandler: adminGuard }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    await client.deleteWorkspace(slug);
    return reply.code(204).send();
  });

  // ----------------------------------------------------------------
  // Document ingestion
  // ----------------------------------------------------------------

  /** Create a Dify document from raw text inside a knowledge base */
  app.post("/admin/documents/text", { preHandler: adminGuard }, async (req, reply) => {
    const body = z
      .object({
        title: z.string().min(1),
        content: z.string().min(1),
        workspaceSlug: z.string().optional(),
      })
      .parse(req.body);

    const result = await client.uploadText(
      resolveWorkspace(body.workspaceSlug),
      body.content,
      body.title
    );
    return reply.code(201).send({
      ...result,
      embedded: true,
      note: "Dify stores documents directly in the target knowledge base.",
    });
  });

  /** Fetch a URL, extract text, and create a Dify document inside a knowledge base */
  app.post("/admin/documents/url", { preHandler: adminGuard }, async (req, reply) => {
    const body = z
      .object({
        url: z.string().url(),
        workspaceSlug: z.string().optional(),
      })
      .parse(req.body);

    const result = await client.uploadUrl(resolveWorkspace(body.workspaceSlug), body.url);
    return reply.code(201).send({
      ...result,
      embedded: true,
      note: "URL ingestion is implemented by fetching the page and sending extracted text to Dify.",
    });
  });

  /** Upload a file (multipart) directly into a Dify knowledge base. Field name: "file" */
  app.post("/admin/documents/file", { preHandler: adminGuard }, async (req, reply) => {
    const data = await req.file();
    if (!data) {
      return reply.code(400).send({ error: "No file uploaded" });
    }
    const workspaceSlug = (req.query as Record<string, string>)["workspaceSlug"];

    const chunks: Buffer[] = [];
    for await (const chunk of data.file) {
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);
    const result = await client.uploadFile(
      resolveWorkspace(workspaceSlug),
      buffer,
      data.filename
    );

    return reply.code(201).send({
      ...result,
      embedded: true,
      note: "Dify stores documents directly in the target knowledge base.",
    });
  });

  // ----------------------------------------------------------------
  // Dify-specific notes and document management
  // ----------------------------------------------------------------

  app.post("/admin/workspaces/:slug/embed", { preHandler: adminGuard }, async (req, reply) => {
    return reply.code(501).send({
      error:
        "Dify does not support AnythingLLM-style attach/embed of an existing global document pool. Create the document directly in the target knowledge base instead.",
    });
  });

  app.post("/admin/workspaces/:slug/unembed", { preHandler: adminGuard }, async (req, reply) => {
    return reply.code(501).send({
      error:
        "Dify does not support AnythingLLM-style unembed. Delete the document from the knowledge base instead.",
    });
  });

  /** List documents in a knowledge base */
  app.get("/admin/workspaces/:slug/documents", { preHandler: adminGuard }, async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const documents = await client.listWorkspaceDocuments(slug);
    return reply.send({ documents });
  });

  /** Inspect indexing progress for a batch returned by document creation endpoints */
  app.get(
    "/admin/workspaces/:slug/documents/:batch/indexing-status",
    { preHandler: adminGuard },
    async (req, reply) => {
      const { slug, batch } = req.params as { slug: string; batch: string };
      const status = await client.getDocumentIndexingStatus(slug, batch);
      return reply.send({ data: status });
    }
  );

  /** Delete a specific document from a knowledge base */
  app.delete(
    "/admin/workspaces/:slug/documents/:documentId",
    { preHandler: adminGuard },
    async (req, reply) => {
      const { slug, documentId } = req.params as { slug: string; documentId: string };
      await client.deleteDocument(slug, documentId);
      return reply.code(204).send();
    }
  );

  /** Backward-compatible delete route using composite location <datasetId>:<documentId> */
  app.delete("/admin/documents/:location", { preHandler: adminGuard }, async (req, reply) => {
    const { location } = req.params as { location: string };
    await client.deleteDocumentByLocation(decodeURIComponent(location));
    return reply.code(204).send();
  });
}
