# Memory

## 2026-09-05 — RunIntel residue scrub
- User showed production readout with demand-side sales voice ("need what you're moving", "orders already placed", "who owns purchasing") and headlines as company names. Those exact strings exist nowhere in the working tree. Production runs a pre-session build. All 5 local commits are unpushed (no remote configured), so nothing fixed locally is live.
- Scrubbed all 10 agents: signal vocabulary (hotel/fit-out out, fab/datacenter in), geo fallback query, buyer-topic comments, supply-inventory watchPhrase branch, capacity bonus units. youtube agent buyer comments fixed too.
- Headline guard at readout build in run.ts plus fallback merge in synthesize.ts: sponsored, over 5 words, or leading preposition/conjunction names never become assessments.
- hypothesis.ts was already equity voiced, left alone. Build passes. Committed as 25b5475. Still needs push plus Vercel deploy to change production.
