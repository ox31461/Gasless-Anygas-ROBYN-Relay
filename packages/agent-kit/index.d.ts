// Type definitions for robyn-agent-kit
// The one-import way for an AI agent to operate gaslessly on Robyn Chain and every EVM
// chain Robyn deploys to. Built on Gasless Pay v1/v2/v3 + the Robyn Router (cross-chain).
//
// Hand-authored to match the runtime exports in index.js exactly.

/** A chain identifier — an EVM chain id, or a named chain such as "stellar". */
export type ChainId = number | string;

/** A token amount in base units. Accepts a bigint or a decimal string. */
export type Amount = string | bigint;

export interface RobynAgentOptions {
  /**
   * An ethers v6 Signer/Wallet. It only ever SIGNS — Robyn's relayer submits and
   * fronts all gas. The signer needs no native balance. Typed loosely so this
   * package does not force an `ethers` dependency on consumers.
   */
  signer?: any;
  /** Robyn service base URL. Defaults to "https://api.anygas.xyz/svc". */
  svc?: string;
  /** EIP-2612 permit version used when signing. Defaults to "1". */
  permitVersion?: string;
}

/** Parameters for a gasless transfer/payment (`pay`). */
export interface PayParams {
  /** Verified fee token to spend (e.g. WETH/USDG). */
  token: string;
  /** Recipient address. */
  to: string;
  /** Amount in `token` base units. */
  amount: Amount;
  /** Routing hint. Defaults to "direct". */
  route?: string;
}

/** Parameters for a gasless purchase through an allowlisted venue (`buy`). */
export interface BuyParams {
  /** Verified fee token to spend. */
  token: string;
  /** Amount in `token` base units. */
  amount: Amount;
  /** Allowlisted venue/target contract. */
  target: string;
  /** ABI-encoded calldata to execute at `target` (embed your own minOut). */
  calldata: string;
  /** Routing hint. Defaults to "direct". */
  route?: string;
}

/** Parameters for paying in ANY verified-swappable token (`payAny`). */
export interface PayAnyParams {
  /** Token the agent actually holds/spends. */
  token: string;
  /** Recipient address. */
  to: string;
  /** Amount in `token` base units. */
  amount: Amount;
  /** Verified asset the fee is atomically converted into. */
  verifiedAsset: string;
  /** Routing hint. Defaults to "direct". */
  route?: string;
}

/** Parameters for quoting a cross-chain route (`route`). */
export interface RouteParams {
  fromChain: ChainId;
  fromToken: string;
  toChain: ChainId;
  toToken: string;
  /** Amount in `fromToken` base units. */
  amount: Amount;
  /** Optional recipient on the destination chain. */
  toAddress?: string;
  /** Optional slippage tolerance. */
  slippage?: number | string;
}

/** Parameters for the one-call agent entry point (`agentDo`). */
export interface AgentDoParams {
  /** Plain-language instruction, e.g. "send 25 USDC to 0xRecipient on arbitrum". */
  intent?: string;
  fromChain?: ChainId;
  toChain?: ChainId;
  /** Token symbol, e.g. "USDC". */
  token?: string;
  /** Human units, e.g. 25 for 25 USDC. */
  amountHuman?: number;
  /** Base units; overrides `amountHuman`. */
  amount?: Amount;
  toAddress?: string;
  /** Run the identical path with no funds and nothing broadcast. */
  sandbox?: boolean;
}

/** The EIP-712 payload to sign when `status` is `"sign"`. */
export interface AgentDoSignRequest {
  mode: 'permit2';
  chainId: number;
  /** Address your Permit2 approval must authorise (the relayer). */
  spender: string;
  /** Canonical Permit2 contract. */
  permit2Contract: string;
  /** ERC-20 being permitted. */
  tokenAddress: string | null;
  amount: Amount;
  what: string;
  submitTo: string;
  submitBody: Record<string, unknown>;
  /** Typed-data to sign: domain, types, primaryType, value. */
  eip712: Record<string, unknown> | null;
  idempotency: string;
}

/** Result of `agentDo`. Branch on `status`; on failure branch on `errorCode`, never message text. */
export interface AgentDoResult {
  status?: 'sign' | 'quoted' | 'done';
  understood?: Record<string, unknown>;
  rail?: string;
  receives?: string;
  durationSec?: number;
  signRequest?: AgentDoSignRequest;
  next?: string;
  warning?: string;
  /** Present instead of `status` when the request was refused. */
  errorCode?: string;
  error?: string;
  retryable?: boolean;
  suggestedAction?: string;
}

/** Parameters for executing a gasless cross-chain move (`crossChain`). */
export interface CrossChainParams {
  fromChain: ChainId;
  fromToken: string;
  /** Amount in `fromToken` base units. */
  amount: Amount;
  toChain: ChainId;
  toToken: string;
  /** Optional recipient (defaults to the signer's address). */
  toAddress?: string;
}

export declare class RobynAgent {
  /** The ethers signer passed at construction. */
  signer: any;
  /** Normalized service base URL (trailing slash stripped). */
  svc: string;
  /** EIP-2612 permit version. */
  permitVersion: string;

  constructor(options: RobynAgentOptions);

  /** The Permit2 canonical address the SDK signs transfers for. */
  readonly permit2: string;

  /** Map of gasless chains from the service info payload. */
  chains(): Promise<Record<string, unknown>>;

  /** Cached service info (`/api/gasless/info`): router, chainId, gaslessChains, ... */
  info(): Promise<Record<string, unknown>>;

  /** The cross-chain route graph + relayer/Permit2 spender (`/api/route/chains`). */
  routeInfo(): Promise<Record<string, unknown>>;

  /** Gasless transfer/payment (v1). `token` must be a verified fee token. */
  pay(params: PayParams): Promise<unknown>;

  /** Gasless purchase through an allowlisted venue (v1 call). */
  buy(params: BuyParams): Promise<unknown>;

  /** Pay in ANY verified-swappable token (v3); fee atomically converted to `verifiedAsset`. */
  payAny(params: PayAnyParams): Promise<unknown>;

  /** Quote the best cross-chain route (read-only). */
  route(params: RouteParams): Promise<unknown>;

  /** Track an in-flight route to DONE by id. */
  routeStatus(id: string): Promise<unknown>;

  /** Params for the one-call entry point (`agentDo`). Supply `intent`, or the structured fields. */
  agentDo(params?: AgentDoParams): Promise<AgentDoResult>;

  /** The error contract: errorCode -> { http, retryable, retryAfterMs, suggestedAction }. */
  errors(): Promise<Record<string, unknown>>;

  /** Move value across chains gaslessly with one Permit2 signature. Returns { id, srcTx, track }. */
  crossChain(params: CrossChainParams): Promise<unknown>;

  /** Non-custodial yield account: aUSDC per chain + allowance granted to the relayer + APY. */
  yieldAccount(agent?: string): Promise<any>;
  /** Read-only JIT quote for a spend from your Aave yield. */
  yieldQuote(a: { srcChain: number | string; amount: bigint | string; toChain?: number | string; toAddress?: string }): Promise<any>;
  /** One-time: approve the relayer to pull your aUSDC up to `budget` (your on-chain cap; revoke with 0). */
  approveYield(a: { chainId: number | string; budget: bigint | string }): Promise<any>;
  /** Spend from your yield with one EIP-712 signature; delivers USDC to toAddress on toChain, gaslessly. */
  yieldSpend(a: { srcChain: number | string; amount: bigint | string; toChain?: number | string; toAddress?: string }): Promise<any>;
}
