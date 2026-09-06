# Memory

## 2026-09-06 — Thesis first

- Live investigation leads everywhere now: first tool, first skill entry, first demo step. Stored reads are labeled memory and admit age past a day.
- Connect page shows an example thesis so the orchestrator synthesis, not the plumbing, is the star.

## 2026-09-06 — Connect-agent page

- Connect your agent is its own page at /connect-agent now, third button under How the loop works on the landing hero. How-it-works links out to it. Verified 200 on prod.

## 2026-09-06 — Connect-your-agent guides

- How-it-works page carries a connect-your-agent section now: per-client setup for Claude Code, VS Code, Cursor, ChatGPT and Codex, plus what each of the nine tools does. README has the same in short form.

## 2026-09-06 — Live grid for outside agents

- Outside agents can now run the actual analyst, not just read past runs. stockintel_investigate starts the full ten-specialist grid, stockintel_inquiry polls to the thesis. Same dispatch and grading as the app, two concurrent outside runs max.
- Verified poll paths, busy guard, validation, and build. Live dispatch mirrors submitInquiry one to one. Committed e795409 and pushed.

## 2026-09-06 — Luna tools plus live URL move

- Live URL is stockintelislive everywhere now. PUBLIC_SUBMIT_URL in Vercel dashboard still needs the manual update.
- Added Luna's top three as honest reads of stored runs: thesis changes with history, conflicting evidence, evidence drill. Skipped catalysts and risk factors, no structured data behind them.
- Verified against real Sept 4 and 5 NVDA runs, including a genuine unclear-to-priced flip. Committed e58fc1e and pushed.

## 2026-09-06 — Agent intelligence tools

- Calling agents get granularity now: stockintel_assess for the full thesis, stockintel_clusters for grouped evidence without verdicts, stockintel_read for market context.
- Shared core in agent-read.ts serves the latest completed run per ticker. Honest empty when none exists. Verified against the real Sept 5 NVDA run on all surfaces. Committed 03ec1d8 and pushed.

## 2026-09-06 — Agent OS correction (unrecognized client)

- Binance consent rejects any agent outside its approved clients, so the in-app OAuth authorize flow is removed entirely. It led to that error for everyone.
- Session model now: BINANCE_MCP_TOKEN minted inside the operator's own supported client session, else public context with no key, else callers bring their exchange leg verbatim.
- Official MCP SDK adopted for our client (stateless per call) and our own server at /mcp with stockintel_read and stockintel_status. POST /api/market/read serves outside agents over HTTP. Shared core in read.ts, provenance always labeled.
- Copied from optic-binance: SDK usage, caller-supplied pattern, own-MCP-server shape, SKILL.md. Kept ours: personal watchlist, thesis pipeline, easiness.
- zod v4 upgrade to unify with the SDK. Holdings now paste-based with the pre-ticked picker. Verified live: market read, MCP initialize and tools/call, caller-supplied provenance. Committed 4ea70cb and pushed.

## 2026-09-06 — Personal Agent OS (user revision)

- Dropped the operator-only model per user direction. Every workspace links its own Agentic sub-account now.
- Post-login popup: explains the link, Authorise or Cancel, no nag after dismiss. Connect Binance OS also lives beside Rename and Sign out.
- Post-authorize holdings picker with all boxes ticked by default, untick to reject. Imports become watchlist entries tagged Agent OS, dupes skipped.
- Synthesis folds watchlist tickers into the market snapshot, marks held lines, and instructs theses to speak through held positions.
- Verified: tsc clean, eslint clean, prod build passes, routes smoke-tested, committed fedb8ea and pushed.

## 2026-09-06 — Agent OS Track A proof complete

- Fixed MCP endpoint to https://www.binance.com/mcp/agentic (agent.binance.com 404s, verified with live probes). Override via AGENT_OS_MCP_URL.
- Server-side MCP calls hit Binance edge WAF challenge, so the design is honest fallback: Agent OS when a user token flows, public mirror otherwise, badge always says which.
- Wired the full workspace OAuth connect flow (PKCE, endpoint discovery, refresh) through /api/binance routes plus React server fns. Market check card has a live badge with Connect and Disconnect.
- Judge artifacts: .mcp.json one-step client wiring, bun scripts/agent-os-probe.ts headless proof, docs/agent-os-track-a.md with setup, architecture, read-only guarantees, and demo script.
- Verified: tsc clean for touched files, bun run build passes, routes smoke-tested on dev, probe tested, committed 05593fd and pushed. Vercel auto-deploys.

## 2026-09-05 — Production live end to end
- App: https://stockintel-eight.vercel.app, auto-deploys from GitHub on push.
- Agents: 10 systemd services on AWS i-0018b77942c4452bc (100.61.3.35:8790-8799), code at /opt/stockintel, deploy key aws-agents read-only.
- DB: sqld docker on same box port 8000, Ed25519 JWT auth. Private key JWK at /tmp/sqld-priv.jwk on Mac only, 10y JWT in Vercel DATABASE_AUTH_TOKEN. Data persists in docker volume sqld-data.
- Vercel env: DATABASE_URL, DATABASE_AUTH_TOKEN, OPENROUTER_API_KEY, ZERO_G_*, OPENCODE_ZEN_API_KEY, VITE_PRIVY_APP_ID, PUBLIC_SUBMIT_URL all set. GitHub integration connected.
- First prod full NVDA call: complete, 10 agents, 30 claims, 8 clusters, llm grading, LLM thesis with merge behavior, live Binance snapshot. Exposed headline fragments plus memecoin mappings, both fixed and verified on names, deployed everywhere.
- Local Mac grid left running for dev. scripts/full-call.ts kept as the full-call driver (PUBLIC_SUBMIT_URL plus DATABASE_URL envs point it at any backend).
