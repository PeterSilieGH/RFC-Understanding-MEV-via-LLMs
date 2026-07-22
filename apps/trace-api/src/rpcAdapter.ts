// Monorepo-owned discovery RPC adapter (ADR-016). This is the shipping home of
// the log-range behavior that was prototyped in the read-only l2beat submodule.
// It is deliberately narrow: l2b remains the discovery/source producer, while
// snapshot code/storage reads and bounded eth_getLogs pagination are shared.

export interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: unknown[];
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type Upstream = (method: string, params: unknown[]) => Promise<unknown>;

const LOG_RANGE_ERROR_PATTERNS = [
  "log response size exceeded",
  "response size exceeded",
  "query returned more than",
  "query timeout exceeded",
  "block range too large",
  "block range is too large",
  "block range is too wide",
  "max block range",
  "exceed maximum block range",
  "range is too large",
  "too many results",
  "response size should not",
  "please limit the query",
];

export function isLogRangeError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  const visit = (value: unknown): void => {
    if (value === null || value === undefined || seen.has(value)) return;
    if (typeof value === "string") {
      messages.push(value);
      return;
    }
    if (typeof value !== "object") return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    // Error.message/stack are non-enumerable, so Object.values misses them; read
    // the common string-bearing keys explicitly before walking enumerable ones.
    for (const key of ["message", "stack", "reason", "error", "data", "body", "cause"]) {
      if (key in record) visit(record[key]);
    }
    for (const nested of Object.values(record)) visit(nested);
  };
  visit(error);
  const text = messages.join(" ").toLowerCase();
  return LOG_RANGE_ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

export class DiscoveryRpcAdapter {
  private readonly immutable = new Map<string, unknown>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private head: Promise<number> | undefined;

  constructor(
    private readonly upstream: Upstream,
    private readonly options: { maxLogBlocks: number; logPageSize: number },
  ) {}

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const id = request.id ?? null;
    if (request.jsonrpc !== undefined && request.jsonrpc !== "2.0") {
      return failure(id, -32600, "invalid JSON-RPC version");
    }
    if (!request.method || !Array.isArray(request.params)) {
      return failure(id, -32600, "method and params are required");
    }
    try {
      const result = await this.send(request.method, request.params);
      return { jsonrpc: "2.0", id, result };
    } catch (error) {
      const upstreamError = error as { code?: unknown; message?: unknown; data?: unknown };
      return failure(
        id,
        typeof upstreamError.code === "number" ? upstreamError.code : -32000,
        typeof upstreamError.message === "string" ? upstreamError.message : "upstream RPC error",
        upstreamError.data,
      );
    }
  }

  async send(method: string, params: unknown[]): Promise<unknown> {
    if (method === "eth_getLogs") return this.getLogs(params);
    if ((method === "eth_getCode" || method === "eth_getStorageAt") && hasImmutableTag(params)) {
      return this.cached(method, params);
    }
    return this.upstream(method, params);
  }

  stats(): { immutable: number; inFlight: number } {
    return { immutable: this.immutable.size, inFlight: this.inFlight.size };
  }

  private async cached(method: string, params: unknown[]): Promise<unknown> {
    const key = `${method}:${JSON.stringify(params)}`;
    if (this.immutable.has(key)) return this.immutable.get(key);
    const active = this.inFlight.get(key);
    if (active) return active;
    const request = this.upstream(method, params)
      .then((value) => {
        this.immutable.set(key, value);
        return value;
      })
      .finally(() => {
        if (this.inFlight.get(key) === request) this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }

  private async getLogs(params: unknown[]): Promise<unknown[]> {
    const filter = asFilter(params[0]);
    if (!filter) return (await this.upstream("eth_getLogs", params)) as unknown[];
    const from = hexBlock(filter.fromBlock);
    const to = hexBlock(filter.toBlock);
    if (from === undefined || to === undefined || from > to) {
      return (await this.upstream("eth_getLogs", params)) as unknown[];
    }

    const head = await this.getHead();
    const cutoff = Math.max(0, head - this.options.maxLogBlocks + 1);
    if (to < cutoff) return [];
    const boundedFrom = Math.max(from, cutoff);
    const logs: unknown[] = [];
    for (let start = boundedFrom; start <= to; start += this.options.logPageSize) {
      const end = Math.min(to, start + this.options.logPageSize - 1);
      logs.push(...(await this.getLogsRange(filter, params.slice(1), start, end)));
    }
    return deduplicateLogs(logs);
  }

  private async getLogsRange(
    filter: Record<string, unknown>,
    trailing: unknown[],
    from: number,
    to: number,
  ): Promise<unknown[]> {
    try {
      return (await this.upstream("eth_getLogs", [
        { ...filter, fromBlock: toHex(from), toBlock: toHex(to) },
        ...trailing,
      ])) as unknown[];
    } catch (error) {
      if (!isLogRangeError(error) || from === to) throw error;
      const middle = Math.floor((from + to) / 2);
      const [left, right] = await Promise.all([
        this.getLogsRange(filter, trailing, from, middle),
        this.getLogsRange(filter, trailing, middle + 1, to),
      ]);
      return [...left, ...right];
    }
  }

  private getHead(): Promise<number> {
    this.head ??= this.upstream("eth_blockNumber", []).then((value) => {
      const head = hexBlock(value);
      if (head === undefined) throw new Error("eth_blockNumber returned an invalid value");
      return head;
    });
    return this.head;
  }
}

export function createHttpUpstream(url: string): Upstream {
  let nextId = 1;
  return async (method, params) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
    });
    if (!response.ok) throw new Error(`upstream RPC HTTP ${response.status}`);
    const body = (await response.json()) as JsonRpcResponse;
    if (body.error) {
      const error = new Error(body.error.message) as Error & { code?: number; data?: unknown };
      error.code = body.error.code;
      error.data = body.error.data;
      throw error;
    }
    return body.result;
  };
}

function hasImmutableTag(params: unknown[]): boolean {
  const tag = params.at(-1);
  return typeof tag === "string" && /^0x[0-9a-f]+$/i.test(tag);
}

function asFilter(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hexBlock(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return undefined;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function toHex(value: number): string {
  return `0x${value.toString(16)}`;
}

function deduplicateLogs(logs: unknown[]): unknown[] {
  const seen = new Set<string>();
  return logs.filter((value, index) => {
    if (typeof value !== "object" || value === null) return true;
    const log = value as Record<string, unknown>;
    const key = `${String(log.blockHash ?? "")}:${String(log.transactionHash ?? "")}:${String(log.logIndex ?? index)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function failure(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}
