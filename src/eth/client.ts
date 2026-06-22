import { ethers } from "ethers";
import Bottleneck from "bottleneck";
import { logger } from "../utils/logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChainConfig {
  name: string;
  rpcUrl: string;
  wsUrl?: string;           // optional WebSocket URL for eth_subscribe (mempool)
  chainId: number;
  explorerUrl?: string;
}

export interface SubscribeOptions {
  /** 'newHeads' | 'pendingTransactions' | 'logs' */
  type: "newHeads" | "pendingTransactions" | "logs";
  params?: {
    address?: string;
    topics?: string[];
  };
}

export interface BlockData {
  number: number;
  hash: string;
  parentHash: string;
  timestamp: number;
  transactions: string[];
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas?: bigint;
  miner: string;
}

export interface TxData {
  hash: string;
  from: string;
  to: string | null;
  value: bigint;
  gasPrice: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  gasLimit: bigint;
  data: string;
  nonce: number;
  chainId: number;
  blockNumber?: number;
  blockHash?: string;
  index?: number;
  v?: number;
  r?: string;
  s?: string;
}

export interface TraceResult {
  type: string;
  from: string;
  to: string;
  value: bigint;
  gasUsed: bigint;
  input: string;
  output?: string;
  calls?: TraceResult[];
  error?: string;
}

// ─── Chain registry ──────────────────────────────────────────────────────────

export const CHAINS: Record<string, ChainConfig> = {
  mainnet:   { name: "Ethereum Mainnet", rpcUrl: process.env.ETHEREUM_RPC_URL    ?? "", wsUrl: process.env.ETHEREUM_RPC_WS_URL, chainId: 1,     explorerUrl: "https://etherscan.io" },
  optimism:  { name: "Optimism",         rpcUrl: process.env.OPTIMISM_RPC_URL    ?? "", chainId: 10,    explorerUrl: "https://optimistic.etherscan.io" },
  arbitrum:  { name: "Arbitrum One",     rpcUrl: process.env.ARBITRUM_RPC_URL    ?? "", chainId: 42161, explorerUrl: "https://arbiscan.io" },
  base:      { name: "Base",             rpcUrl: process.env.BASE_RPC_URL        ?? "", chainId: 8453,  explorerUrl: "https://basescan.org" },
};

// ─── Ethereum Client ─────────────────────────────────────────────────────────

export class EthClient {
  private provider: ethers.JsonRpcProvider;
  private wsProvider?: ethers.WebSocketProvider;
  private limiter: Bottleneck;
  private chainId: number;
  private chainName: string;
  private rpcUrl: string;

  constructor(config: ChainConfig, rateLimitRps = 50) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
    this.chainId = config.chainId;
    this.chainName = config.name;
    this.rpcUrl = config.rpcUrl;

    if (config.wsUrl) {
      this.wsProvider = new ethers.WebSocketProvider(config.wsUrl, config.chainId);
      logger.info(`[EthClient] WS provider ready: ${config.wsUrl}`);
    }

    this.limiter = new Bottleneck({ minTime: 1000 / rateLimitRps });
    logger.info(`[EthClient] Initialized for ${config.name} (chainId=${config.chainId})`);
  }

  static fromChain(chain: string): EthClient {
    const config = CHAINS[chain.toLowerCase()];
    if (!config?.rpcUrl) {
      throw new Error(
        `Chain "${chain}" not found. Set {CHAIN}_RPC_URL in .env (e.g. ETHEREUM_RPC_URL)`
      );
    }
    return new EthClient(config);
  }

  // ── Block data ────────────────────────────────────────────────────────────

  async getLatestBlockNumber(): Promise<number> {
    return this.limiter.schedule(() => this.provider.getBlockNumber());
  }

  async getBlock(blockNumber: number | "latest" = "latest", full = true): Promise<BlockData | null> {
    const block = await this.limiter.schedule(() => this.provider.getBlock(blockNumber, full));
    if (!block) return null;

    return {
      number: Number(block.number ?? 0n),
      hash: block.hash ?? "",
      parentHash: block.parentHash ?? "",
      timestamp: Number(block.timestamp),
      transactions: block.transactions.map((tx) =>
        typeof tx === "string" ? tx : (tx as ethers.TransactionResponse).hash
      ),
      gasUsed: block.gasUsed,
      gasLimit: block.gasLimit,
      baseFeePerGas: block.baseFeePerGas ?? undefined,
      miner: block.miner ?? ethers.ZeroAddress,
    };
  }

  async getBlocksInRange(start: number, end: number): Promise<BlockData[]> {
    const blocks: BlockData[] = [];
    for (let i = start; i <= end; i++) {
      const b = await this.getBlock(i);
      if (b) blocks.push(b);
      if (blocks.length % 100 === 0) {
        logger.info(`[EthClient] Fetched blocks ${start}–${i}/${end}`);
      }
    }
    return blocks;
  }

  // ── Transaction data ──────────────────────────────────────────────────────

  async getTransaction(hash: string): Promise<TxData | null> {
    const tx = await this.limiter.schedule(() => this.provider.getTransaction(hash));
    if (!tx) return null;

    return {
      hash: tx.hash,
      from: tx.from,
      to: tx.to ?? null,
      value: tx.value,
      gasPrice: (tx as any).gasPrice ?? 0n,
      maxFeePerGas: (tx as any).maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: (tx as any).maxPriorityFeePerGas ?? undefined,
      gasLimit: tx.gasLimit,
      data: tx.data,
      nonce: tx.nonce,
      chainId: Number(tx.chainId),
      blockNumber: tx.blockNumber ?? undefined,
      blockHash: tx.blockHash ?? undefined,
      index: tx.index ?? undefined,
      v: (tx as any).v,
      r: (tx as any).r,
      s: (tx as any).s,
    };
  }

  async getTransactionReceipt(hash: string) {
    return this.limiter.schedule(() => this.provider.getTransactionReceipt(hash));
  }

  // ── State & tracing ──────────────────────────────────────────────────────

  /**
   * Trace a call against the state at a given block.
   * Requires a node that supports debug_traceCall (e.g. Erigon, Nethermind).
   */
  async traceCall(tx: {
    from?: string;
    to: string;
    data?: string;
    value?: bigint;
    gas?: bigint;
  }, blockNumber: number | "latest" = "latest"): Promise<TraceResult | null> {
    try {
      const result = await this.rawCall<any>("debug_traceCall", [
        {
          from: tx.from ?? undefined,
          to: tx.to,
          data: tx.data ?? "0x",
          value: tx.value ? `0x${tx.value.toString(16)}` : "0x0",
          gas: tx.gas ? `0x${tx.gas.toString(16)}` : undefined,
        },
        typeof blockNumber === "number" ? `0x${blockNumber.toString(16)}` : "latest",
        { tracer: "callTracer" },
      ]);
      if (!result) return null;
      return this._parseTraceResult(result);
    } catch (err) {
      logger.warn(`[EthClient] traceCall failed: ${(err as Error).message}`);
      return null;
    }
  }

  private _parseTraceResult(raw: any): TraceResult {
    return {
      type: raw.type ?? "CALL",
      from: raw.from ?? ethers.ZeroAddress,
      to: raw.to ?? ethers.ZeroAddress,
      value: BigInt(raw.value ?? "0"),
      gasUsed: BigInt(raw.gasUsed ?? "0"),
      input: raw.input ?? "",
      output: raw.output ?? undefined,
      calls: raw.calls?.map((c: any) => this._parseTraceResult(c)),
      error: raw.error ?? undefined,
    };
  }

  // ── Storage & code ────────────────────────────────────────────────────────

  async getStorageAt(address: string, slot: string, block: number | "latest" = "latest"): Promise<string> {
    return this.limiter.schedule(() => this.provider.getStorage(address, slot, block));
  }

  async getCode(address: string, block: number | "latest" = "latest"): Promise<string> {
    return this.limiter.schedule(() => this.provider.getCode(address, block));
  }

  // ── Gas ───────────────────────────────────────────────────────────────────

  async getGasPrice(): Promise<bigint> {
    return this.limiter.schedule(() => this.provider.getFeeData()).then((d) => d.gasPrice ?? 0n);
  }

  async getFeeData() {
    return this.limiter.schedule(() => this.provider.getFeeData());
  }

  // ── Raw RPC ───────────────────────────────────────────────────────────────

  /**
   * Send a raw JSON-RPC call. Use for custom methods (debug_*, eth_subscribe, etc.)
   */
  async rawCall<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
    return this.limiter.schedule(async () => {
      const resp = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const json = await resp.json() as { result?: T; error?: { message: string } };
      if (json.error) throw new Error(`RPC error (${method}): ${json.error.message}`);
      return json.result as T;
    });
  }

  // ── WebSocket subscriptions ──────────────────────────────────────────────

  /**
   * Subscribe to WebSocket events (newHeads, pendingTransactions, logs).
   * Requires wsUrl to be configured on the client.
   *
   * @example
   * ```
   * const off = await eth.subscribe({ type: "pendingTransactions" }, (txHash) => {
   *   console.log(`Pending tx: ${txHash}`);
   * });
   * // later: off() to unsubscribe
   * ```
   */
  async subscribe(
    opts: SubscribeOptions,
    handler: (data: unknown) => void
  ): Promise<() => Promise<void>> {
    if (!this.wsProvider) {
      throw new Error(
        "WebSocket not available. Pass wsUrl in ChainConfig, or set ETHEREUM_RPC_WS_URL env var."
      );
    }

    let subParams: unknown[];
    switch (opts.type) {
      case "newHeads":
        subParams = ["newHeads"];
        break;
      case "pendingTransactions":
        subParams = ["pendingTransactions"];
        break;
      case "logs":
        subParams = ["logs", {
          address: opts.params?.address,
          topics: opts.params?.topics,
        }];
        break;
    }

    const sub = await this.wsProvider.send("eth_subscribe", subParams) as string;
    const listener = (...args: unknown[]) => { try { handler(args[0]); } catch { /* drop */ } };

    this.wsProvider.on(sub, listener);
    logger.info(`[EthClient] Subscribed: ${opts.type} (sub=${sub})`);

    return async () => {
      try {
        await this.wsProvider!.send("eth_unsubscribe", [sub]);
        this.wsProvider!.off(sub, listener);
        logger.info(`[EthClient] Unsubscribed: ${opts.type}`);
      } catch (err) {
        logger.warn(`[EthClient] Failed to unsubscribe: ${(err as Error).message}`);
      }
    };
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get chain(): number {
    return this.chainId;
  }

  get providerInstance(): ethers.JsonRpcProvider {
    return this.provider;
  }

  get wsProviderInstance(): ethers.WebSocketProvider | undefined {
    return this.wsProvider;
  }
}