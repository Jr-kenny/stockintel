# Thesis price chart — options on file

Status: research only. No decision, no build. Pick when ready.

Goal (when/if): each assessment shows the watched ticker's current Binance
price as a chart, and the thesis body explains the chart. Data in all cases:
Binance klines (public, no key; bStocks history starts June 2026) plus event
dates from the assessment's own evidence. Synthesis receives a price-shape
summary so the body can reference what the reader sees.

## A — Recharts area chart

- What: area/line price trace styled to our paper aesthetic, thesis events
  as dots, verdict as a shaded region (e.g. priced zone).
- Helps: zero new dependencies (already installed), fastest to build,
  matches the light UI directly, declarative React.
- Costs: SVG slows past ~1k points (fine for 90 daily bars); no real
  candlesticks (faked only); marker interactions snap to vertices.

## B — TradingView Lightweight Charts (Apache-2.0)

- What: finance-native canvas engine. Candlesticks + volume, built-in
  markers API for thesis events, crosshair, pro-terminal feel.
- Helps: the credible choice if the chart must look like a trading product;
  ~12 KB gzip; event markers are first-class; optional CandleKit layer adds
  indicators/drawings later.
- Costs: new dependency; canvas needs explicit theme bridging to our
  palette; client-only (no SSR); React wrapper needed.

## C — Thesis-embedded mini chart (custom SVG, zero deps)

- What: small price trace drawn inside each assessment card with event dots;
  full chart only on demand.
- Helps: lightest possible; the chart lives where the thesis lives, so the
  "thesis explains the chart" requirement is structural, not bolted on.
- Costs: custom code to own (scales, axes, hover); no candles; weakest for
  judges expecting a terminal.

## D — Apache ECharts (Apache-2.0)

- What: candles + volume + zoom + markers + anything else in one library.
- Helps: broadest coverage if one library must do everything later.
- Costs: heaviest bundle (~80-130 KB à la carte); config-driven API is the
  furthest from our component style; overkill for one price trace.

## Data notes (all options)

- `GET /api/v3/klines?symbol=NVDABUSDT&interval=1d&limit=90` — public.
- Symbol mapping reuses `companyToTicker` + bStock resolution in
  `src/lib/binance/market.ts`.
- Event markers come from evidence `observed` dates already stored per claim.
- Synthesis already receives a live snapshot; a price-shape summary
  (trend, range position, recent move) would extend the existing
  `MARKET SNAPSHOT` block, no new pipeline needed.
