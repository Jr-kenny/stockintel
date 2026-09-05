# OSS research for the StockIntel system

Status: research only. Nothing adopted yet. Each entry: what it is, how it
could help us, verdict.

Doctrine filter for everything below: objective over checklist, chain over
score, thesis first price last. Take mechanics, never verdicts.

## 1. TradingAgents (TauricResearch, Apache-2.0, ~100k stars)

- What: trading-firm simulation. Analysts (fundamentals, sentiment, news,
  technical) → bull/bear researcher debate → trader → risk manager.
  LangGraph, multi-LLM, paper with backtests.
- Helps us: the bull/bear debate is a working template for our invalidation
  path (argue against the thesis, don't just support it). The risk-manager
  role mirrors our "what could invalidate this" requirement.
- Verdict: borrow the debate mechanic. Reject the order ticket: BUY/SELL/HOLD
  proposals are the opposite of our assessment doctrine.

## 2. FinMem (MIT)

- What: single trading agent with layered memory (short/mid/long/reflection)
  plus post-outcome reflection that writes lessons back into memory.
- Helps us: validates our Sibyl direction and adds the missing loop:
  reflect a thesis against later price action, store the lesson, route the
  next similar watch differently. Our follow-up queue could grow this.
- Verdict: adopt the reflection loop later. No code needed now.

## 3. sellside-research-engine (2026, open source)

- What: full pipeline. EDGAR XBRL fundamentals, multi-scenario DCF, peer
  comps, transcript tone + guidance extraction, VaR/CVaR risk, GS-style notes.
- Helps us: REVERSE DCF is the prize. It back-solves the growth rate priced
  into the current price, which is direct math for our market test
  ("already priced?") to sit beside the narrative verdict. Transcript
  guidance-tone extraction would also strengthen our media evidence.
- Verdict: strongest find. Reverse-DCF check belongs in our market-test
  step; transcript tone belongs in evidence grading.

## 4. earnings-research-agent (LangGraph, open source)

- What: parallel agentic RAG over transcripts + filings per ticker, with
  peer selection, signal cards, human-in-the-loop review.
- Helps us: peer selection feeds our exposure graph (related assets without
  hardcoding them). Signal-card shape matches our assessment cards, good
  reference for the chart+thesis layout.
- Verdict: borrow peer discovery + card shape thinking.

## 5. Earnings-call-transcript / 8-K JSON APIs (Apify, MCP-ready)

- What: speaker-tagged transcripts plus 8-K filings parsed by item code
  (2.02 earnings, 5.02 executive changes, 1.05 cybersecurity), guidance
  sentence extraction, sentiment scores, full-text search across all filers.
- Helps us: drop-in evidence source richer than RSS scraping. Item codes
  are pre-typed catalyst events; guidance sentences are thesis fuel.
- Verdict: evaluate as an evidence connector when we expand sources.

## 6. finviz-sec-mcp (MIT, 24 free tools)

- What: screener (67+ filters), fundamentals, insider Form 3/4/5 activity,
  analyst ratings/revisions, all free, MCP-native.
- Helps us: insider clusters + analyst revisions are extra exposure signals
  our specialists don't watch today. Screener runs the reverse direction:
  find tickers with events forming, not just events for watched tickers.
- Verdict: insider + revisions feeds for the evidence layer later.

## 7. edgar-scanner (Pdong19, open source)

- What: full-text search over every 10-K (EFTS), 12-dimension scorer, Form 4
  insider cluster detection, forward-moat signals (backlog, capex inflection).
- Helps us: searching what companies FILE beats scraping what's reported.
  Form 4 clusters are tradeable catalyst events. Capex-inflection detection
  maps straight onto our buildout theses.
- Verdict: EFTS full-text discovery is the biggest evidence upgrade on this
  list. Consider before adding more news sources.

## 8. FinRobot (Apache-2.0)

- What: Perception/Brain/Action agent platform for finance, Financial CoT,
  equity research report generation.
- Helps us: mostly platform. Report-shape thinking only.
- Verdict: skip. We have our own rails.

## Chart note (kept separate, see chart-options.md)

- Recharts area (option A) remains the pick: no exchange affiliation,
  matches our skin, fastest. Thesis-body references chart shape via the
  existing MARKET SNAPSHOT block extended with trend/range lines.
