export const packageName = "@platform/search-runtime";

export class SearchError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SearchError";
    this.cause = cause;
  }
}

export interface SearchQuery {
  q: string;
  filters?: Record<string, string | number | boolean>;
  page?: number;
  limit?: number;
}

export interface SearchResult<T> {
  items: T[];
  total: number;
  took: number;
}

export interface SearchPort<T extends { id: string }> {
  index(document: T): Promise<void>;
  bulk(documents: T[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult<T>>;
  delete(id: string): Promise<void>;
}

export function createInMemorySearchPort<T extends { id: string }>(): SearchPort<T> {
  const docs = new Map<string, T>();
  return {
    async index(doc) {
      docs.set(doc.id, doc);
    },
    async bulk(documents) {
      documents.forEach((d) => docs.set(d.id, d));
    },
    async search({ q, limit = 10, page = 1 }) {
      const start = Date.now();
      const lower = q.toLowerCase();
      const matched = [...docs.values()].filter((d) =>
        JSON.stringify(d).toLowerCase().includes(lower),
      );
      const startIdx = (page - 1) * limit;
      return {
        items: matched.slice(startIdx, startIdx + limit),
        total: matched.length,
        took: Date.now() - start,
      };
    },
    async delete(id) {
      docs.delete(id);
    },
  };
}
