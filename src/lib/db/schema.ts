import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
  endpoint: text("endpoint").notNull(),
  wallet: text("wallet").notNull(),
  agenticId: text("agentic_id"),
  status: text("status").notNull().default("online"),
  reliability: real("reliability").notNull().default(0.8),
  createdAt: text("created_at").notNull(),
  lastSeen: text("last_seen").notNull(),
});

export const supplyRecords = sqliteTable("supply_records", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Workspace account identity that owns this entry (null for legacy rows). */
  identity: text("identity"),
  detailJson: text("detail_json").notNull().default("[]"),
  marketsJson: text("markets_json").notNull().default("[]"),
  targetsJson: text("targets_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const inquiries = sqliteTable("inquiries", {
  id: text("id").primaryKey(),
  /** Workspace account identity that owns this run (null for guest runs). */
  identity: text("identity"),
  question: text("question").notNull(),
  category: text("category"),
  geography: text("geography"),
  status: text("status").notNull().default("dispatching"),
  agentsMatched: integer("agents_matched").notNull().default(0),
  claimsReceived: integer("claims_received").notNull().default(0),
  sourcesClustered: integer("sources_clustered").notNull().default(0),
  contradictions: integer("contradictions").notNull().default(0),
  readoutJson: text("readout_json"),
  readoutAnchorRoot: text("readout_anchor_root"),
  readoutAnchorTx: text("readout_anchor_tx"),
  gradeMode: text("grade_mode"),
  gradeCostOg: real("grade_cost_og"),
  gradeError: text("grade_error"),
  synthesisJson: text("synthesis_json"),
  investigationJson: text("investigation_json"),
  /**
   * Connection pass output: interpreted evidence plus named causal chains.
   * Written before synthesis, which reads from it instead of reasoning from
   * four truncated claim rows.
   */
  connectionJson: text("connection_json"),
  /** "llm" when a model connected the evidence, "deterministic" when it fell back. */
  connectMode: text("connect_mode"),
  /** Persisted Binance snapshot taken at synthesis time (for outcome reflection). */
  marketJson: text("market_json"),
  error: text("error"),
  dispatchedAt: text("dispatched_at"),
  windowClosesAt: text("window_closes_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const claims = sqliteTable("claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inquiryId: text("inquiry_id").notNull(),
  agentId: text("agent_id").notNull(),
  company: text("company").notNull(),
  claim: text("claim").notNull(),
  confidence: real("confidence").notNull(),
  evidenceJson: text("evidence_json").notNull().default("[]"),
  whyRelevant: text("why_relevant"),
  contact: text("contact"),
  tier: text("tier"),
  weight: real("weight"),
  dimsJson: text("dims_json"),
  gradeMode: text("grade_mode"),
  llmNote: text("llm_note"),
  submittedAt: text("submitted_at").notNull(),
});

export const opportunities = sqliteTable("opportunities", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  location: text("location"),
  industry: text("industry"),
  need: text("need").notNull(),
  summary: text("summary").notNull(),
  confidence: real("confidence").notNull(),
  status: text("status").notNull().default("open"),
  window: text("window"),
  size: text("size"),
  contact: text("contact"),
  evidenceIdsJson: text("evidence_ids_json").notNull().default("[]"),
  inquiryId: text("inquiry_id").notNull(),
  anchorRoot: text("anchor_root"),
  anchorTx: text("anchor_tx"),
  createdAt: text("created_at"),
});

export const evidenceRecords = sqliteTable("evidence_records", {
  id: text("id").primaryKey(),
  company: text("company").notNull(),
  claim: text("claim").notNull(),
  source: text("source").notNull(),
  sourceType: text("source_type").notNull().default("agent submission"),
  agent: text("agent").notNull(),
  observed: text("observed").notNull(),
  status: text("status").notNull().default("verified"),
  note: text("note"),
  anchorRoot: text("anchor_root"),
  anchorTx: text("anchor_tx"),
  inquiryId: text("inquiry_id"),
  createdAt: text("created_at").notNull(),
});

export const graphNodes = sqliteTable("graph_nodes", {
  id: text("id").primaryKey(),
  inquiryId: text("inquiry_id").notNull(),
  type: text("type").notNull(),
  label: text("label").notNull(),
  source: text("source"),
  createdAt: text("created_at").notNull(),
});

export const graphEdges = sqliteTable("graph_edges", {
  id: text("id").primaryKey(),
  inquiryId: text("inquiry_id").notNull(),
  fromId: text("from_id").notNull(),
  toId: text("to_id").notNull(),
  relation: text("relation").notNull(),
  claim: text("claim"),
  confidence: real("confidence"),
  source: text("source"),
  createdAt: text("created_at").notNull(),
});

export const dispatchAcks = sqliteTable("dispatch_acks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inquiryId: text("inquiry_id").notNull(),
  agentId: text("agent_id").notNull(),
  declined: integer("declined").notNull().default(0),
  respondedAt: text("responded_at").notNull(),
});

/**
 * Workspace accounts (one per signed-in business) and their credit ledger.
 * Free trial runs are counted, paid credits are consumed per intelligence
 * run, and every top-up payment is recorded with its on-chain tx hash.
 */
export const accounts = sqliteTable("accounts", {
  id: text("id").primaryKey(),
  identity: text("identity").notNull().unique(),
  email: text("email"),
  wallet: text("wallet"),
  credits: integer("credits").notNull().default(0),
  freeRunsUsed: integer("free_runs_used").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at"),
});

export const creditLedger = sqliteTable("credit_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(),
  delta: integer("delta").notNull(),
  kind: text("kind").notNull(), // free_run | run | topup | run_payment
  txHash: text("tx_hash"),
  inquiryId: text("inquiry_id"),
  /** Native ETH actually received (run_payment rows) — Base chain. */
  paidNative: real("paid_native"),
  // Compat: prime-layer uses paid_og; keep paid_native canonical for Base.
  // If any DB still uses paid_og, ensureSchema migrates it.
  paidOg: real("paid_og"),
  createdAt: text("created_at").notNull(),
});

export const settlements = sqliteTable("settlements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inquiryId: text("inquiry_id").notNull(),
  agentId: text("agent_id").notNull(),
  wallet: text("wallet").notNull(),
  weight: real("weight").notNull(),
  amountUsd: real("amount_usd").notNull(),
  tx: text("tx"),
  /** Native amount actually sent to the agent (USDC value recorded at settlement). */
  paidNative: real("paid_native"),
  // Compat alias for prime-layer's paid_og
  paidOg: real("paid_og"),
  payoutTx: text("payout_tx"),
  payoutError: text("payout_error"),
  createdAt: text("created_at").notNull(),
});

// ── Sibyl memory layer ──────────────────────────────────────────────────────
// Six stores that make intelligence compound across cycles instead of
// restarting at zero on every inquiry. See README "Sibyl memory layer".

// 1. Source Registry — fingerprints of every source ever cited. Cross-inquiry
//    independence: a source cited again next week is the SAME cluster, never a
//    fresh confirmation.
export const memorySources = sqliteTable("memory_sources", {
  id: text("id").primaryKey(), // sourceClusterKey(source)
  displaySource: text("display_source").notNull(),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
  timesCited: integer("times_cited").notNull().default(1),
  cyclesJson: text("cycles_json").notNull().default("[]"),
});

// 2. Claim Store — what was claimed about whom, and whether it ever resolved.
export const memoryClaims = sqliteTable("memory_claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  company: text("company").notNull(),
  claim: text("claim").notNull(),
  status: text("status").notNull().default("open"), // open | confirmed | expired
  agentId: text("agent_id"), // who first surfaced this claim — drives targeted re-checks
  firstConfidence: real("first_confidence").notNull(),
  bestConfidence: real("best_confidence").notNull(),
  firstSeen: text("first_seen").notNull(),
  lastSeen: text("last_seen").notNull(),
  inquiryIdsJson: text("inquiry_ids_json").notNull().default("[]"),
});

// 3. Reliability Ledger — per-agent per-cycle contribution history. Input to
//    the reward formula and the "yo I remember you" follow-up routing.
export const memoryAgentHistory = sqliteTable("memory_agent_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id").notNull(),
  inquiryId: text("inquiry_id").notNull(),
  discoveryCount: integer("discovery_count").notNull().default(0),
  confirmationCount: integer("confirmation_count").notNull().default(0),
  duplicationCount: integer("duplication_count").notNull().default(0),
  weightSum: real("weight_sum").notNull().default(0),
  verifiedRecalls: integer("verified_recalls").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

// 4. Demand Graph nodes — companies accumulating signal strength over time.
export const memoryCompanies = sqliteTable("memory_companies", {
  company: text("company").primaryKey(),
  currentNeed: text("current_need"),
  signalStrength: real("signal_strength").notNull().default(0),
  signalsCount: integer("signals_count").notNull().default(0),
  bestConfidence: real("best_confidence").notNull().default(0),
  status: text("status").notNull().default("open"), // open | verified | expired
  windowNote: text("window_note"),
  firstSignalAt: text("first_signal_at").notNull(),
  lastSignalAt: text("last_signal_at").notNull(),
});

// 5. Inquiry Store — past inquiries for similarity matching on new requests.
export const memoryInquiries = sqliteTable("memory_inquiries", {
  id: text("id").primaryKey(), // inquiry id
  question: text("question").notNull(),
  category: text("category"),
  geography: text("geography"),
  tokensJson: text("tokens_json").notNull().default("[]"),
  companiesJson: text("companies_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

// 6. Follow-up Queue — scheduled re-verification derived from timing windows.
//    This is what turns Customer B's answer into something better than
//    Customer A's, and lets claims re-check themselves without any customer.
export const memoryFollowups = sqliteTable("memory_followups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  company: text("company").notNull(),
  agentId: text("agent_id").notNull(),
  note: text("note").notNull(),
  priorClaim: text("prior_claim"),
  priorConfidence: real("prior_confidence"),
  dueAt: text("due_at").notNull(),
  status: text("status").notNull().default("pending"), // pending | dispatched | done
  dispatchedAt: text("dispatched_at"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at").notNull(),
});

// ── Binance Agent OS OAuth ────────────────────────────────────────────────
// Per-workspace user tokens from the Agent OS authorization-code flow.
// Read-only scopes only; the app never requests trade or transfer scopes.

export const binanceOauthStates = sqliteTable("binance_oauth_states", {
  state: text("state").primaryKey(),
  identity: text("identity").notNull(),
  verifier: text("verifier").notNull(),
  createdAt: text("created_at").notNull(),
});

export const binanceTokens = sqliteTable("binance_tokens", {
  identity: text("identity").primaryKey(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: text("expires_at"),
  scope: text("scope"),
  updatedAt: text("updated_at").notNull(),
});
