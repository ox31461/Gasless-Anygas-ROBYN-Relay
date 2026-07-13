// Type definitions for robyn-adapters/core
// The shared Robyn client used by every framework adapter. Read (mesh/quote/status)
// and execute (crossChain via a single Permit2 signature).

/** A chain identifier — an EVM chain id, or a named chain such as "stellar". */
export type ChainId = number | string;

/** The canonical Permit2 contract address. */
export declare const PERMIT2: string;

export interface RobynClientOptions {
  /** Robyn service base URL, e.g. "https://<gateway>/svc". Defaults to "https://api.anygas.xyz/svc". */
  svc?: string;
  /** An ethers v6 Signer/Wallet — only needed for `crossChain`. It signs; it never sends. */
  signer?: any;
}

/** Arguments for a read-only cross-chain quote. */
export interface RobynQuoteArgs {
  fromChain: ChainId;
  fromToken: string;
  toChain: ChainId;
  toToken: string;
  /** Amount in `fromToken` base units, as a string. */
  amount: string;
  /** Optional recipient on the destination chain. */
  toAddress?: string;
  [key: string]: unknown;
}

/** Arguments for executing a gasless cross-chain move. */
export interface RobynCrossChainArgs {
  fromChain: ChainId;
  fromToken: string;
  /** Amount in `fromToken` base units. */
  amount: string | bigint;
  toChain: ChainId;
  toToken: string;
  /** Optional recipient (defaults to the signer's address). */
  toAddress?: string;
  /** Optional Permit2 deadline offset in seconds. Defaults to 3600. */
  ttlSecs?: number;
}

/** The client returned by `robyn(...)`. */
export interface RobynClient {
  /** List the Robyn gasless chains + route graph (`/api/route/chains`). */
  mesh(): Promise<Record<string, unknown>>;
  /** Quote the best gasless route between two chains (`/api/route/quote`). */
  quote(args: RobynQuoteArgs): Promise<unknown>;
  /** Track an in-flight route by id (`/api/route/status`). */
  status(id: string): Promise<unknown>;
  /** Move value across chains gaslessly with one Permit2 signature. Requires a signer. */
  crossChain(args: RobynCrossChainArgs): Promise<unknown>;
  /** Normalized service base URL. */
  readonly _svc: string;
  /** Whether a signer was provided. */
  readonly _hasSigner: boolean;
}

/** Create the shared Robyn client. */
export declare function robyn(options?: RobynClientOptions): RobynClient;

/** Canonical tool metadata reused by every adapter. */
export interface RobynToolMeta {
  description: string;
  params: Record<string, string>;
}

export declare const TOOLS: {
  robyn_mesh: RobynToolMeta;
  robyn_quote: RobynToolMeta;
  robyn_route_status: RobynToolMeta;
  robyn_cross_chain: RobynToolMeta;
};
