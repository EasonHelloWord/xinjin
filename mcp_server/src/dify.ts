import { z } from "zod";

const DatasetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable().optional(),
    indexing_technique: z.string().nullable().optional(),
    document_count: z.number().optional(),
    total_documents: z.number().optional(),
    created_at: z.number().optional(),
    updated_at: z.number().optional(),
  })
  .passthrough();

const DocumentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    indexing_status: z.string().nullable().optional(),
    display_status: z.string().nullable().optional(),
    error: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    archived: z.boolean().optional(),
    created_at: z.number().optional(),
    word_count: z.number().optional(),
    tokens: z.number().optional(),
  })
  .passthrough();

const RetrievalResponseSchema = z.object({
  query: z.object({ content: z.string() }).passthrough().optional(),
  records: z
    .array(
      z.object({
        score: z.number().nullable().optional(),
        segment: z
          .object({
            id: z.string(),
            document_id: z.string(),
            content: z.string().nullable().optional(),
            answer: z.string().nullable().optional(),
            word_count: z.number().nullable().optional(),
            tokens: z.number().nullable().optional(),
            summary: z.string().nullable().optional(),
            document: z
              .object({
                id: z.string(),
                name: z.string().nullable().optional(),
                data_source_type: z.string().nullable().optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      })
    )
    .default([]),
});

const IndexingStatusSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        indexing_status: z.string().optional(),
        processing_started_at: z.number().nullable().optional(),
        parsing_completed_at: z.number().nullable().optional(),
        cleaning_completed_at: z.number().nullable().optional(),
        splitting_completed_at: z.number().nullable().optional(),
        completed_at: z.number().nullable().optional(),
        paused_at: z.number().nullable().optional(),
        error: z.string().nullable().optional(),
        stopped_at: z.number().nullable().optional(),
        completed_segments: z.number().optional(),
        total_segments: z.number().optional(),
      })
    )
    .default([]),
});

type DatasetApiRecord = z.infer<typeof DatasetSchema>;
type DocumentApiRecord = z.infer<typeof DocumentSchema>;

export interface WorkspaceListItem {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  indexingTechnique?: string | null;
  documentCount?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface DifyDocument {
  id: string;
  datasetId: string;
  location: string;
  name: string;
  indexingStatus?: string | null;
  displayStatus?: string | null;
  error?: string | null;
  enabled?: boolean;
  archived?: boolean;
  createdAt?: number;
  wordCount?: number;
  tokens?: number;
}

export interface DocumentCreateResponse {
  location: string;
  datasetId: string;
  documentId: string;
  batch?: string;
  document: DifyDocument;
}

export interface WorkspaceVectorSearchResult {
  id: string;
  text: string;
  score?: number;
  documentId?: string;
  datasetId: string;
  url?: string;
  title?: string;
  docSource?: string;
  chunkSource?: string;
  wordCount?: number;
  token_count_estimate?: number;
}

export interface WorkspaceVectorSearchResponse {
  results: WorkspaceVectorSearchResult[];
}

export interface DocumentIndexingStatus {
  id: string;
  indexingStatus?: string;
  processingStartedAt?: number | null;
  parsingCompletedAt?: number | null;
  cleaningCompletedAt?: number | null;
  splittingCompletedAt?: number | null;
  completedAt?: number | null;
  pausedAt?: number | null;
  error?: string | null;
  stoppedAt?: number | null;
  completedSegments?: number;
  totalSegments?: number;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildLocation(datasetId: string, documentId: string): string {
  return `${datasetId}:${documentId}`;
}

function parseLocation(location: string): { datasetId: string; documentId: string } {
  const parts = location.split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      "Invalid document location. Expected the Dify composite format <datasetId>:<documentId>."
    );
  }
  return { datasetId: parts[0], documentId: parts[1] };
}

function normalizeDataset(record: DatasetApiRecord): WorkspaceListItem {
  return {
    id: record.id,
    name: record.name,
    slug: record.id,
    description: record.description ?? null,
    indexingTechnique: record.indexing_technique ?? null,
    documentCount: record.document_count ?? record.total_documents,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

function normalizeDocument(datasetId: string, record: DocumentApiRecord): DifyDocument {
  return {
    id: record.id,
    datasetId,
    location: buildLocation(datasetId, record.id),
    name: record.name,
    indexingStatus: record.indexing_status ?? null,
    displayStatus: record.display_status ?? null,
    error: record.error ?? null,
    enabled: record.enabled,
    archived: record.archived,
    createdAt: record.created_at,
    wordCount: record.word_count,
    tokens: record.tokens,
  };
}

function htmlToText(html: string): { title: string | null; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]
    ?.replace(/\s+/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .trim();

  const cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { title: title ?? null, text: cleaned };
}

/**
 * Dify Knowledge API client.
 * Workspace semantics from the previous AnythingLLM integration are now mapped
 * to Dify knowledge bases (datasets).
 */
export class DifyClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  readonly defaultDataset: string;

  constructor(baseUrl: string, apiKey: string, defaultDataset = "") {
    this.base = baseUrl.replace(/\/$/, "") + "/v1";
    this.headers = {
      Authorization: `Bearer ${apiKey}`,
    };
    this.defaultDataset = defaultDataset;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      bodyType?: "json" | "form";
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const headers = { ...this.headers, ...(options?.headers ?? {}) };
    let body: BodyInit | undefined;

    if (options?.bodyType === "form") {
      body = options.body as BodyInit;
    } else if (options?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const res = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Dify ${method} ${path} -> ${res.status}: ${text}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async listAllDatasets(): Promise<DatasetApiRecord[]> {
    const results: DatasetApiRecord[] = [];
    let page = 1;

    while (true) {
      const data = await this.request<{
        data: unknown[];
        has_more?: boolean;
      }>("GET", `/datasets?page=${page}&limit=100`);

      const pageItems = z.array(DatasetSchema).parse(data.data ?? []);
      results.push(...pageItems);

      if (!data.has_more || pageItems.length === 0) {
        return results;
      }
      page += 1;
    }
  }

  private async listAllDocuments(datasetId: string): Promise<DocumentApiRecord[]> {
    const results: DocumentApiRecord[] = [];
    let page = 1;

    while (true) {
      const data = await this.request<{
        data: unknown[];
        has_more?: boolean;
      }>("GET", `/datasets/${datasetId}/documents?page=${page}&limit=100`);

      const pageItems = z.array(DocumentSchema).parse(data.data ?? []);
      results.push(...pageItems);

      if (!data.has_more || pageItems.length === 0) {
        return results;
      }
      page += 1;
    }
  }

  private async resolveDatasetId(slugOrId: string): Promise<string> {
    if (!slugOrId) {
      if (!this.defaultDataset) {
        throw new Error("No knowledge base specified and DIFY_DEFAULT_DATASET_ID is not set.");
      }
      slugOrId = this.defaultDataset;
    }

    const datasets = await this.listAllDatasets();
    const exact = datasets.find((item) => item.id === slugOrId);
    if (exact) {
      return exact.id;
    }

    const normalized = slugify(slugOrId);
    const matches = datasets.filter(
      (item) =>
        item.name === slugOrId ||
        item.name.toLowerCase() === slugOrId.toLowerCase() ||
        slugify(item.name) === normalized
    );

    if (matches.length === 1) {
      return matches[0].id;
    }

    if (matches.length > 1) {
      throw new Error(
        `Knowledge base reference "${slugOrId}" is ambiguous. Use the dataset UUID returned by list_workspaces.`
      );
    }

    throw new Error(`Knowledge base "${slugOrId}" was not found in Dify.`);
  }

  private normalizeCreateResponse(
    datasetId: string,
    data: { document: unknown; batch?: string }
  ): DocumentCreateResponse {
    const document = normalizeDocument(datasetId, DocumentSchema.parse(data.document));
    return {
      location: document.location,
      datasetId,
      documentId: document.id,
      batch: data.batch,
      document,
    };
  }

  async listWorkspaces(): Promise<WorkspaceListItem[]> {
    const datasets = await this.listAllDatasets();
    return datasets.map(normalizeDataset);
  }

  async createWorkspace(name: string): Promise<WorkspaceListItem> {
    const dataset = await this.request<unknown>("POST", "/datasets", {
      body: {
        name,
        permission: "only_me",
      },
    });
    return normalizeDataset(DatasetSchema.parse(dataset));
  }

  async deleteWorkspace(slug: string): Promise<void> {
    const datasetId = await this.resolveDatasetId(slug);
    await this.request("DELETE", `/datasets/${datasetId}`);
  }

  async rawVectorSearch(
    slug: string,
    query: string,
    topN = 4
  ): Promise<WorkspaceVectorSearchResponse> {
    const datasetId = await this.resolveDatasetId(slug);
    const response = RetrievalResponseSchema.parse(
      await this.request<unknown>("POST", `/datasets/${datasetId}/retrieve`, {
        body: { query },
      })
    );

    return {
      results: response.records.slice(0, topN).map((record) => ({
        id: record.segment.id,
        text: record.segment.content ?? record.segment.answer ?? record.segment.summary ?? "",
        score: record.score ?? undefined,
        documentId: record.segment.document_id,
        datasetId,
        title: record.segment.document?.name ?? undefined,
        docSource: record.segment.document?.id,
        chunkSource: record.segment.document?.data_source_type ?? undefined,
        wordCount: record.segment.word_count ?? undefined,
        token_count_estimate: record.segment.tokens ?? undefined,
      })),
    };
  }

  async listWorkspaceDocuments(slug: string): Promise<DifyDocument[]> {
    const datasetId = await this.resolveDatasetId(slug);
    const documents = await this.listAllDocuments(datasetId);
    return documents.map((item) => normalizeDocument(datasetId, item));
  }

  async getDocumentIndexingStatus(slug: string, batch: string): Promise<DocumentIndexingStatus[]> {
    const datasetId = await this.resolveDatasetId(slug);
    const response = IndexingStatusSchema.parse(
      await this.request<unknown>("GET", `/datasets/${datasetId}/documents/${batch}/indexing-status`)
    );

    return response.data.map((item) => ({
      id: item.id,
      indexingStatus: item.indexing_status,
      processingStartedAt: item.processing_started_at,
      parsingCompletedAt: item.parsing_completed_at,
      cleaningCompletedAt: item.cleaning_completed_at,
      splittingCompletedAt: item.splitting_completed_at,
      completedAt: item.completed_at,
      pausedAt: item.paused_at,
      error: item.error,
      stoppedAt: item.stopped_at,
      completedSegments: item.completed_segments,
      totalSegments: item.total_segments,
    }));
  }

  async uploadText(
    datasetRef: string,
    textContent: string,
    documentTitle: string
  ): Promise<DocumentCreateResponse> {
    const datasetId = await this.resolveDatasetId(datasetRef);
    const data = await this.request<{ document: unknown; batch?: string }>(
      "POST",
      `/datasets/${datasetId}/document/create-by-text`,
      {
        body: {
          name: documentTitle,
          text: textContent,
          indexing_technique: "high_quality",
          process_rule: { mode: "automatic" },
        },
      }
    );
    return this.normalizeCreateResponse(datasetId, data);
  }

  async uploadUrl(datasetRef: string, webUrl: string): Promise<DocumentCreateResponse> {
    const datasetId = await this.resolveDatasetId(datasetRef);
    const res = await fetch(webUrl);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Failed to fetch URL ${webUrl} -> ${res.status}: ${text}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const raw = await res.text();
    const parsed = contentType.includes("text/html") ? htmlToText(raw) : { title: null, text: raw };
    const fallbackTitle = new URL(webUrl).hostname + new URL(webUrl).pathname;
    const title = parsed.title || fallbackTitle || webUrl;

    if (!parsed.text.trim()) {
      throw new Error(`Fetched URL ${webUrl} but no text content could be extracted.`);
    }

    const data = await this.request<{ document: unknown; batch?: string }>(
      "POST",
      `/datasets/${datasetId}/document/create-by-text`,
      {
        body: {
          name: title.slice(0, 255),
          text: `Source URL: ${webUrl}\n\n${parsed.text}`,
          indexing_technique: "high_quality",
          process_rule: { mode: "automatic" },
        },
      }
    );

    return this.normalizeCreateResponse(datasetId, data);
  }

  async uploadFile(
    datasetRef: string,
    buffer: Buffer,
    filename: string
  ): Promise<DocumentCreateResponse> {
    const datasetId = await this.resolveDatasetId(datasetRef);
    const formData = new FormData();
    formData.append(
      "data",
      JSON.stringify({
        indexing_technique: "high_quality",
        process_rule: { mode: "automatic" },
      })
    );
    formData.append("file", new Blob([new Uint8Array(buffer)]), filename);

    const data = await this.request<{ document: unknown; batch?: string }>(
      "POST",
      `/datasets/${datasetId}/document/create-by-file`,
      {
        body: formData,
        bodyType: "form",
      }
    );

    return this.normalizeCreateResponse(datasetId, data);
  }

  async deleteDocumentByLocation(location: string): Promise<void> {
    const { datasetId, documentId } = parseLocation(location);
    await this.request("DELETE", `/datasets/${datasetId}/documents/${documentId}`);
  }

  async deleteDocument(slug: string, documentId: string): Promise<void> {
    const datasetId = await this.resolveDatasetId(slug);
    await this.request("DELETE", `/datasets/${datasetId}/documents/${documentId}`);
  }
}
