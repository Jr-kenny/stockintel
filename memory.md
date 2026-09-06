# Memory

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
