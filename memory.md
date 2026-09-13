# Memory

## 2026-09-13 — Judge-safe run time, 20m to about 5m

Wait was wave one 90s plus wave two 300s plus up to two follow-up rounds
plus LLM retries at two temperatures with 180s timeouts. Worst case the
connect and report passes alone could stall 18 minutes each. New defaults:
wave one 45s, wave two 150s, follow-ups capped at one round of 25s
(`PRIME_MAX_FOLLOWUP_ROUNDS=2` restores deep mode), single temperature per
provider with 90s caps on connect and report, 45s on grade and hypotheses,
30s on follow-up planning. Agents fetch Google News in parallel and hit
GDELT on the first two queries only instead of serially sleeping 5.2s per
query, synced from web-research to all eight clones. Poll now returns live
claims, live agents, wave, and elapsed seconds during collecting, and the UI
shows wave 1 of 2 versus 2 of 2 with live counts plus grading progress. Copy
updated from about 5 minutes to about 2 to 3 minutes. tsc clean, build
passes in 2s.

## 2026-09-11 — 0G leads the thesis chain with multi-key fallback

0G is now the lead provider in `src/lib/llm/providers.ts`, OpenRouter behind
it, Zen last. `compute-router.ts` reads every key in order: the
comma-separated `ZERO_G_COMPUTE_API_KEYS` list plus `ZERO_G_COMPUTE_API_KEY`
and `_2` through `_9` suffixes. Only key-level rejections (401/402/403,
insufficient, balance, quota) roll to the next key, so a bad request never
burns every key at once. Verified live: chain resolves to 0G first, rotation
test passes on injected 402, real ping through the refactored client returned
clean JSON. OpenRouter default flipped to
`nvidia/nemotron-3-super-120b-a12b:free` since minimax-m3:free and glm-5.2:free
went paid (404). Nemotron answers pings in 10s but invents its own shape on
the connect contract, so it stays a free fallback, not the lead. Three keys
wired and verified live: primary sk-41dd plus sk-20389b and sk-3c1990 as _2
and _3, each answered a ping. Note glm-5
returned empty once and truncated fenced JSON once during the checks while
the deepseek-v4-flash fallback answered clean, so the flaky-deployment path
still earns its keep.

Deployed to AWS as fb67700: three 0G keys plus ZERO_G_NETWORK=mainnet and
the mainnet router URL appended to /etc/stockintel/orchestrator.env (the box
had no 0G keys at all, so every prior run there graded without 0G), pulled,
restarted all ten units plus orchestrator, all active. Box probe confirms
0G lead, 3 keys, live ping clean.

First live run on the new chain (INQ-mtwdjas0cmcm, NVDA, complete in ~20m):
35 wave-one claims, 86 total capped to 30, full report with 0 traceability
issues. Every fallback fired at least once: 0G t=0.3 aborted and t=0.6
truncated on connect, Nemotron wrote connect instead (5 events, 2 chains),
primary 0G key hit 402 mid-run and rotation moved to key 2, which wrote the
report clean. Thesis: DOJ probe over the $20B Groq licensing deal vs an $18B
coordinated investment offensive, priced, moderate confidence. Lesson: 0G
glm-5 is flaky on 10k-token outputs under load, the chain depth is what
saved the run, not any single provider.

## 2026-09-07 — One orchestrator on AWS, Vercel cut off the run path

Cutover is done and pushed as 167655d. submitInquiry and agentInvestigate
insert the row and return, both polls read the row only. Dispatch, wave
advance, grade, connect and report belong to agents/orchestrator on the box.
Vercel no longer imports run.ts, confirmed by zero hits for
gradeAndSynthesize in the build output, so the old in-request path cannot
run there. Only agents/orchestrator and local scripts import run.ts now.

Why: Vercel kills at 300s, collection spends it all, the report pass needs
around 7 minutes, so the report always died inside a request. The service
ticks every 5s under lease, proven live on INQ-mtqom69wr3sj to complete with
connect llm and report llm, 0 traceability issues, pricedIn priced.

First poll may show dispatching with 0 agents before the service picks the
row up. The UI already renders that as opening the investigation, so no
change was needed there. tsc clean, build passes.

Live proof on a TSLA run submitted through Vercel after deploy,
INQ-mtqpbkyepz6n. Vercel inserted the row and never touched it again. The
box dispatched at 03:49, early-advanced wave one on all 10 answers, opened
wave two from 5 hypotheses, early-graded wave two on all 10 answers,
30 claims. Connect llm with 8 events and 4 chains, 23 entities and 13 edges
persisted. Report took two OpenRouter misses then Zen wrote it, 0
traceability issues, pricedIn priced. Complete at 03:56 with the full
document served from the poll. No web request lived longer than seconds
across a 7 minute run, which is the entire point of the cutover.

## 2026-09-06 — Report shipped end to end, OpenRouter leads

Built the target architecture from the audit below. Four commits: fa72836, 3ccfa7c,
03dbd1e, 2937491, plus this one.

### Pipeline now

dispatch → grade (quality judged orchestrator-side) → connect (named causal chains)
→ measure priced-in (event dates vs candles) → write report → render.

New modules: `source-quality.ts`, `connect.ts`, `report.ts`, `write-report.ts`,
`render-report.ts`, `event-reaction.ts`, `providers.ts`, `ReportView.tsx`.

### Fixed from the audit

- Recursion never ran: `depth 0` in state, local counter never synced, every
  `shouldRecurse` branch gated on `depth === 1`. Synced plus widened to `<= 1`.
- Ten agents were one Google News query (72 rows, 8 distinct claims). Each now owns
  a BEAT (fetchers, publisher domains, query angles). Live probe returns disjoint
  publisher sets. `scripts/sync-agent-body.ts` propagates the shared body,
  `scripts/apply-beats.ts` writes the configs, both idempotent.
- Collectors no longer judge: `confidence` fixed at 0 (kept on the wire for older
  orchestrators), `whyRelevant` deleted from all ten. It was four hardcoded
  templates keyed off a headline verb, and `grade.ts` read the adjacent confidence
  straight into its quality dimension.
- Quality now from publisher tier + freshness + independent corroboration, each
  with a stated reason. The stored intellectia.ai claim went 0.70 → 0.21/low.
- Priced-in measured, not asserted: a move beyond 1.5x the median daily band on the
  session containing the event counts as absorbed. Old code gated on
  `confidence >= 70`, which measured our sourcing, not the market.
- Per-company thesis replaced by one report: executive first, evidence with
  why-it-matters and our-read, synthesis chains, four horizons, scenarios with
  invalidation, bottom line. `traceabilityIssues()` gates it.
- Entity extraction fixed as a side effect: the connection pass drops headline
  fragments ("TSMC Is", "Great AI Silicon") and resolves real entities.

### Provider order

OpenRouter leads, 0G and Zen behind. `src/lib/llm/providers.ts` owns it in one
place, used by all five passes. Model picked by probing the real connect contract
with a 7-event payload:

- `minimax/minimax-m3:free` — 2/2 pass, 26-32s, ~2400 of 4000 tokens. CHOSEN.
- `nvidia/nemotron-3-super-120b-a12b:free` — 1 pass then truncated at cap
- `z-ai/glm-5.2:free`, `google/gemma-4-31b-it:free` — HTTP 429
- `deepseek/deepseek-r1:free`, `qwen/qwen3-coder:free` — HTTP 404, no longer free

0G kept as fallback: it returned empty content and fenced JSON on the deeper
schemas often enough to cost a run.

### Domain neutrality (user correction, important)

NVDA is only a test fixture. Thousands of users, any market. I introduced a
semiconductor-flavoured `TRADE_HOSTS` list and had to fix it: trade press is now
matched structurally by sector and publication words in the domain stem, and
regulators by suffix pattern (`gov.ng`, `go.jp`, `gouv.fr`, `gob.mx`), so a tender
board in Lagos is as primary as the SEC. 22 classification cases pass.

Verified on three sectors, not one:
- semiconductors (stored NVDA evidence): found that the $700B capex headline and
  the Trainium/Maia wins are the same dollar pool, so the bull number funds the
  bear case. Two contradictions where `detectContradictions` always returned 0.
- shipping (MAERSK): found Rotterdam congestion eats the rate gain before it
  reaches operating profit.
- Nigerian cement (DANGCEM): found the volume tailwind rests on competitor
  misfortune, not organic demand, and said a thesis holding only because rivals
  are weaker is fragile.

### Surfaces

MCP `stockintel_assess` renders the report. `agentThesisChanges` compares one
priced-in call and confidence band. `agentConflicting` builds the counter-case from
contradictions, down/mixed chains, bear case, invalidation. `agentEvidence`
resolves against interpreted entities. All fall back to the legacy shape for old
runs, which say so plainly rather than passing a thesis off as a report.

Web UI: `ReportView.tsx` renders executive → synthesis → market → scenarios →
evidence → bottom line. Evidence ids are traceable chips, hop basis is colour-coded
(observed / inferred / speculative dimmed). SSR-tested for section order and for
the empty-report fallback (no orphan headers). Examples and facts diversified off
semiconductors.

### Deploy note

Agents run on AWS at `/opt/stockintel` from a read-only deploy key. Source of truth
is this repo. Deploy via SSM (`aws ssm send-command --instance-ids
i-0018b77942c4452bc`): pull, then restart the ten `stockintel-<agent>`
services by name. Unit names are agent names, not ports. Grid restarted on
`02176f2` 2026-09-06, all ten healthy with fresh registrations.

### Still open

- Legacy synthesis path removed 2026-09-06: `run.ts` no longer calls
  `synthesizeInquiry`, `synthesize.ts` deleted, the reflect script carries its
  own legacy type. New runs write report plus readout only. Old `synthesis_json`
  rows still read as fallback in the UI and MCP layer, schema column untouched.
- 0G fenced-JSON fixed 2026-09-06: `chatJson` normalizes once and returns clean
  JSON the way OpenRouter already does, instead of raw fenced content that died
  in caller-side slices.
- Agent intake fixed 2026-09-06: all ten agents read `whatToVerify`,
  `investigation`, `memory_brief`, `memory_recheck`. Verify lists, open
  questions, entities, and brief words feed the relevance gate, assigned
  rechecks become beat-aimed queries capped at two. Canonical body lives in
  `web-research`, `sync-agent-body.ts` propagated to eight, `media-youtube`
  fixed separately.
- Live proof 2026-09-06: `INQ-mtpk6l26p1mk` ran the full grid on prod, 10 agents,
  30 claims, 38 clusters, complete with no error. Report carries 4 evidence, 3
  multi-hop chains, 30/50/20 scenarios, invalidation, contradictions, pricedIn
  priced at moderate confidence. The run exposed that stored reads skipped
  report-only runs, fixed in `agent-read.ts` with report-first results plus a
  cross-migration comparison, verified live on inquiry and assess.
- Two-wave dispatch is live, observation gap closed by construction: wave one is a
  short open sweep, hypotheses form from wave-one returns plus tape plus memory,
  wave two is the aimed hunt. `observe.ts` stays as the cold-start fallback when
  wave one returns nothing. Short sweep is `PRIME_WAVE1_WINDOW_SECONDS`, default 90s.
- Agents still ignore `whatToVerify`, `investigation`, `memory_brief`,
  `memory_recheck`. All four are dispatched and read by nobody.
- Chain persistence is live: `persistConnectionChains` writes each connection hop
  as one entity-to-entity edge with basis in the claim prefix and evidence ids
  in source, `entityChainsForInquiry` reads the traversable layer back. Base
  graph build now clears per-inquiry rows first so retries stay idempotent.
- Follow-up planner is live in `plan-followups.ts`: LLM picks 2 to 6 checks from
  real gaps with the old loop as fallback. `deriveFollowUpTasks` stays as the
  deprecated sync path. Recurse rounds call the planner.
- 0G fenced-JSON parse failure is on our side, worth a look.
- Paid runs removed 2026-09-06 per user direction: no metering, no pay-per-run,
  no contributor payouts. Deleted `credits.ts`, `account-fns.ts`, `base/payments.ts`,
  `base/payouts.ts`, plus `smoke-credits`, `smoke-pay-per-run`, `retry-payouts`,
  `base-smoke` scripts. `run.ts` grades and reports with no settlement block,
  `fns.ts` submits free, app page has no paywall or credit counts, workspace
  agent rows carry no earnings. Schema tables stay for old DBs, nothing reads them.
- ACP SELL side removed same day: `handleAcpEntry`, `DEMAND_READOUT_OFFERING`,
  `parseIntelRequest` gone, `buyIntel` takes the offering name as a param, the
  node script handles buyer events only. `tsc --noEmit` is clean and `bun run build`
  passes.

## 2026-09-06 — Orchestrator verification plus target report architecture

Code-level audit of the intelligence loop, then the user's correction of what it should be.
No code changed. This entry is the spec for the rebuild.

### What the code actually does today

Execution order: `submitInquiry` (fns.ts:46) inserts, calls `runInquiry` (run.ts:125).
`extractScope` regex, then `recallForInquiry`, then `generateHypotheses` (one LLM call), then
`buildInitialInvestigation`, then one identical `ResearchCommand` to every online agent
(`agentsOnGrid`, run.ts:82). Returns. A poll (`getInquiry`, fns.ts:182) triggers
`gradeAndSynthesize` (run.ts:388): deterministic cluster grading, optional `runFollowUpRounds`,
`llmGradeClaims`, readout, `synthesizeInquiry` (synthesize.ts:490).

So the real shape is question, hypothesis, fan-out news search, cluster, market gauge, thesis.

### Confirmed failures, with evidence

- **Ten agents are one agent.** `md5 agents/*/index.ts` plus `diff` shows the only differences are
  `CONNECTOR_PORT`, `NAME`, `SPECIALTY`. All hit `fetchGoogleNews` + `fetchGdelt` + `fetchEdgar`.
  Proof in the DB: `INQ-mtnscydjabre` has 72 claim rows, 9 distinct agents, **8 distinct claims**.
  Nine agents, one search.
- **Hypotheses never drive investigation.** `buildQueries` (agents/web-research/index.ts:107) uses
  only `h.searchHints`. `whatToVerify` is never read by any agent. `investigation` arrives typed
  `unknown` (line 100) and is never touched. `memory_brief` and `memory_recheck` are dispatched and
  read by nobody (grep: zero references across all ten agents).
- **No observation before hypothesis.** `generateHypotheses` (hypothesis.ts:176) is called with only
  the question string. No prices, no headlines, no prior state. The stored Sept 5 hypotheses are
  model recollection: "TSMC CoWoS Packaging Bottleneck", `searchHints: ["TSMC CoWoS capacity
  expansion 2025 delay"]`. The market snapshot doesn't run until synthesis, at the very end.
- **Recursion has never executed.** Every stored run has `investigation_json.depth === 0`.
  `buildInitialInvestigation` sets `depth: 0`, `shouldRecurse` only has branches for `depth >= 1`,
  and `depth` is only bumped inside `runFollowUpRounds`. Dead on the first pass, always.
- **Connection is regex and templates, never reasoning.** `deriveFollowUpTasks`
  (investigation.ts:98) is a hardcoded 3xN loop emitting the same three objectives.
  `evidence-graph.ts:16` only makes `announced_in`, `owns` (regex on hotel|estate|mall|hospital),
  `likely_needs`. **No entity ever links to another entity**, so no A to B to C path can exist.
  `exposurePath` (synthesize.ts:231) is a keyword switch with canned semiconductor phrasing.
  `detectContradictions` (scoring.ts:60) matches month names and "completed" vs "construction",
  returns 0 on every stored run.
- **Synthesis is a summarizer.** Fed `withSources.slice(0, 4)`, `top_claim` truncated to 300 chars,
  two sources each (synthesize.ts:657), asked for a 4-sentence body.
- **Entities come from headline regex.** `extractCompany` / `cleanName` (agent lines 273-328) is why
  the stored run shipped `"TSMC Is"`, `"Great AI Silicon"`, `"AI Infrastructure Investment Boom"`,
  and `"Intel Foundry secures contract"` as companies, each with its own verdict.
- **Timeframe is price geometry, not evidence.** `marketVerdict` picks from three literals
  ("unclear, needs confirmation", "days to weeks", "1 to 4 weeks") from `run14` and range position.
  `MarketFacts` carries no event dates. LLM override validated only by `length > 2`.
- **Pricing verdict is half-grounded.** The gauge (`positioningGauge`, market-test.ts:65) is real
  live candle math and honestly emits measurements only. But `confidence >= 70` gating means
  "priced in" really means "stock ran recently and our evidence is thin". Event dates and price
  moves both exist and are never joined. The LLM invented "fair value band roughly $215 to $245",
  passed through because the guard (synthesize.ts:398) only rejects buy/sell/long/short.
- **Sources are real but links are wrong.** Traceable end to end, no post-hoc fetching anywhere.
  But `agents/web-research/index.ts:439` stores `publisherUrl`, so URLs are homepages
  (`https://wccftech.com`). The reader can't verify the claim.
- **MCP layer is fine.** `stockintel-mcp.ts` reads stored runs honestly, labels staleness past 24h,
  returns honest empties. `stockintel_investigate` dispatches the same real grid. Not the problem.
- **`soul.md` doctrine reaches every LLM pass via `guidedSystem` and no code implements it.**
  Nothing asks for a chain, nothing validates one exists.

Keepers: hypothesis generation, the Binance gauge, executive-first ordering (`preamble` renders
before sources).

### Target architecture (user's direction, this supersedes the current design)

**Specialists collect, they do not analyse.** An admin gets the assignment and sends its goons to
bring back findings. Each goon has its own beat and its own sources. They return the event, the
source, what happened, verbatim. No verdict, no hypothesis, no confidence, no `whyRelevant`.
That is the orchestrator's job and they are currently stealing it.

**The orchestrator is the analyst.** It hypothesizes, dispatches, receives, joins, connects,
interprets, concludes. All judgment lives in one place.

**The output is one intelligence report, not a thesis per company.** Sections in order:

1. Executive intelligence. Conclusion first, before any sources. What happened, what matters,
   current assessment. The reader should not have to read 15 articles to learn why they matter.
2. Evidence. Per event: source, what happened (no invention), why it matters in the context of the
   watched name's business and supply chain and competitors, then "our read".
3. Cross-source synthesis. A + B + C therefore D, or deeper reading of A, B, C opens E, F, G, H.
   Includes capacity and collaboration reasoning, for example: X and Y want a mega datacenter, Y
   lacks the capacity alone, so a Z collab is likely or they fall back to W.
4. Market implication by horizon: immediate, 1 to 4 weeks, 1 to 3 months, 3 to 12 months.
5. Scenarios: bull, base, bear, catalysts, risks, invalidation signals. Falsifiable. Not "we believe
   NVDA will benefit" but "our assessment stays positive unless X happens".
6. Bottom line. What to remember, the single most important signal to monitor next, what would force
   a rethink.

**Every factual claim traceable, confidence calibrated to evidence strength.** Not "AI demand is
accelerating" but "we assess it's accelerating because X, Y, Z occurred per these sources, though Z
is weaker evidence so confidence is moderate rather than high".

**MCP callers reach the orchestrator, never the specialists.** An outside agent calling in gets the
orchestrator, which directs our own specialists. Clusters return evidence plus how it connects,
without a full thesis per cluster.

### Conflicts to resolve before building

- `SynthesisRecommendation` (agent-read.ts) requires `verdict`, `marketCall`, `timeframe`,
  `confidence` per entity. The per-company thesis is baked into the type system. The report schema
  has to change shape, not just its prompt, or sections get bolted onto the same wrong structure.
- Specialist contract must narrow to collection-only. Strip `confidence` and `whyRelevant` from
  agent submissions.
- One timeframe string where four horizons are needed.
- No scenario layer exists as structured fields. Hypothesis stage already demands an invalidation
  path, so the instinct is in the code and never reaches the output.
- `graph_edges` needs entity to entity relations (`supplies`, `competes_with`, `customer_of`) so a
  chain can be stored and traversed.
- Confidence must become an evidence-strength judgment, not a weighted average of source count and
  freshness.
- Resolve the Google News redirect so sources link to articles.
- Fix the `depth` initialization so recursion can fire.
- Add an observation pass before hypothesis (live price, fresh headlines, prior run state).
- Add an LLM connection pass over the full evidence set before synthesis, output being the chain
  itself: event, named intermediate hops, direction, magnitude, each step labeled observed fact,
  inference, or speculation.
- Join event dates against price moves for the priced-in call. Both inputs already exist.

## 2026-09-07 — Empty reports on complete runs, and the "watch" leak

Two real bugs behind "run says complete, report is empty". Both fixed and verified live.

**1. Status was written before the report.** `gradeAndSynthesize` set `status: "complete"`
alongside the readout, then ran the connection and report passes afterwards inside a `try` whose
`catch` only logged. Any poll landing in that gap, or any run whose report pass died (invocation
ceiling, redeploy, crash), returned `{result: null, error: null}` — success with nothing in it, and
no way for a caller to tell that apart from a genuinely empty run. Now the row goes to `grading`
after grading, and `status: "complete"` is written in the SAME update as `report_json`. The catch
completes the run with the failure recorded on `error` instead of swallowing it.

**2. "Watch" was a search term.** Agents tokenize the question into their fallback query, their
relevance vocabulary, and their EDGAR full-text topics. `STOPWORDS` (duplicated in all nine agents)
never included "watch", so `"Watch NVDA: ..."` searched SEC 8-Ks for **watch** — EDGAR only takes
the first two topic words — and the relevance gate is a substring match, so any filing containing
"watch" or "change" or "value" passed. That is the whole mechanism behind Rank One Computing,
SYNLOGIC, STURM RUGER et al. appearing at 82% in an NVDA run. Fixed centrally in `topicQuestion`
at the single `dispatchWave` funnel rather than in nine separately deployed agents: strips the
framing verb, drops generic filler ("happening", "materially", "world", "value", "change"), keeps
real signal ("export", "controls", "supply"). Safe because no agent sends question text to a model.
The stored question is untouched, so the UI still shows what was asked.

Supporting: `tryGradeIfReady` now also handles `grading` rows (`finishStalledReport` — adopts a
stored report, or completes with the reason after 300s idle, or retries a dead grade), and both
poll paths were gated on `collecting` only, so stalled rows were unreachable. Read side now
explains a complete-but-empty run instead of answering null/null, which is what surfaces the
already-broken historical rows.

Verified: EDGAR topics went `["watch","nvda"]` → `["nvda"]` on a live run; run held at `grading`
with 30 claims / 16 clusters while writing, then completed with a 24KB report, 9 sections,
3 chains; prod `INQ-mtqiws5an6ew` returns a full report. tsc clean, build passes, no new lint.
Recovery unit-tested on all three cases including "genuinely still working" (correctly untouched).

Note: the report's own E2 entry describes the watch-keyword match as low-confidence noise — the
analyst diagnosed the bug in its own evidence set.

**Agent-side gap closed and grid redeployed.** `topicQuestion` covers every path today, but the
nine question-tokenizing agents each carry their own `STOPWORDS` copy and none held "watch", so an
agent called directly was still wrong on its own. Framing verbs and generic filler added to all
nine; subject-bearing terms (export, supply, controls, china, datacenter) deliberately kept.
media-youtube untouched, it never tokenizes the question.

Proven by posting the RAW unmodified question straight to web-research, bypassing the orchestrator
fix: `queries: ["watch","nvda"]` → `["nvda"]`, raw signals 202 → 15.

Deployed `bd239e5` to AWS via SSM (`02176f2` → `bd239e5`), restarted all ten units, 0 failed, all
ten ports 200, fresh registrations. Confirmed on the box with the raw question: `queries: ["nvda"]`.
Local dev grid stopped afterwards, temp logs and TEST- rows cleaned.

Deploy recipe that works (SSM, no interactive shell):
`aws ssm send-command --instance-ids i-0018b77942c4452bc --document-name AWS-RunShellScript`
then `cd /opt/stockintel && GIT_SSH_COMMAND="ssh -i /root/.ssh/aws-agents" git pull --ff-only
origin master`, then restart `stockintel-<agent>` units by name. Poll with
`aws ssm get-command-invocation`. Remote box is `ip-172-31-5-156`, agents bind `100.61.3.35`.

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
