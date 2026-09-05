import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import "./city.css";

type Building = {
  ticker: string;
  blurb: string;
  thesis: string;
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
  c: string;
  cols: number;
  rows: number;
  venue?: boolean;
};

const BUILDINGS: Building[] = [
  { ticker: "AAPL", blurb: "Apple · iPhone and services", thesis: "Edge demand follows data center spend with a lag.", x: 20, y: 20, w: 90, d: 90, h: 220, c: "#a9b7c9", cols: 5, rows: 9 },
  { ticker: "META", blurb: "Meta · ads and AI", thesis: "Open compute buyer. Build pace shows in capex calls.", x: 125, y: 30, w: 75, d: 70, h: 110, c: "#e9c1a0", cols: 4, rows: 5 },
  { ticker: "AVGO", blurb: "Broadcom · networking chips", thesis: "Fabric ties the cluster together. Networking rides each expansion.", x: 30, y: 130, w: 80, d: 70, h: 80, c: "#b9d4c2", cols: 4, rows: 4 },
  { ticker: "MSFT", blurb: "Microsoft · cloud and AI", thesis: "Capex guidance starts here. A raise moves the whole block.", x: 320, y: 20, w: 70, d: 120, h: 170, c: "#c9bfe0", cols: 4, rows: 7 },
  { ticker: "AMZN", blurb: "Amazon · cloud and retail", thesis: "Second cloud signal. Confirms demand is broad, not one buyer.", x: 410, y: 30, w: 90, d: 80, h: 130, c: "#9fb8d8", cols: 5, rows: 6 },
  { ticker: "24/7", blurb: "bStocks Exchange · trade day and night", thesis: "Tokenized stocks trade around the clock, so exposure never sleeps.", x: 330, y: 160, w: 170, d: 50, h: 40, c: "#e6a49a", cols: 8, rows: 2, venue: true },
  { ticker: "JPM", blurb: "JPMorgan · banking", thesis: "Financing conditions set the pace of new builds.", x: 20, y: 320, w: 120, d: 80, h: 90, c: "#e8dcc4", cols: 6, rows: 4 },
  { ticker: "TSLA", blurb: "Tesla · EVs and robots", thesis: "Power and factory signals cross over from autos.", x: 30, y: 420, w: 80, d: 90, h: 150, c: "#dcb3b8", cols: 4, rows: 7 },
  { ticker: "MU", blurb: "Micron · memory chips", thesis: "Every GPU rack needs memory. Buildouts pull MU second.", x: 150, y: 330, w: 60, d: 60, h: 60, c: "#c3ccb0", cols: 3, rows: 3 },
  { ticker: "NVDA", blurb: "NVIDIA · GPUs and AI infra", thesis: "Hyperscale buildouts land here first. Watch capex guides, then price.", x: 330, y: 330, w: 80, d: 80, h: 260, c: "#a8cfd0", cols: 4, rows: 11 },
  { ticker: "PLTR", blurb: "Palantir · data and AI", thesis: "Deployment layer. Contracts confirm demand is real.", x: 430, y: 340, w: 80, d: 60, h: 45, c: "#ecd9a1", cols: 4, rows: 2 },
  { ticker: "GOOGL", blurb: "Alphabet · search and cloud", thesis: "TPU versus GPU mix shifts exposure at the margin.", x: 340, y: 430, w: 160, d: 80, h: 100, c: "#cfc5d6", cols: 8, rows: 5 },
];

const TREES: [number, number][] = [
  [150, 150], [180, 120], [340, 100], [60, 470],
  [470, 150], [490, 470], [230, 400], [200, 470],
];

const WATCH: [string, string][] = [
  ["NVDA", "NVDABUSDT"],
  ["TSLA", "TSLABUSDT"],
  ["AAPL", "AAPLBUSDT"],
  ["MSFT", "MSFTBUSDT"],
  ["AMZN", "AMZNBUSDT"],
  ["META", "METABUSDT"],
  ["GOOGL", "GOOGLBUSDT"],
  ["AVGO", "AVGOBUSDT"],
  ["MU", "MUBUSDT"],
  ["DELL", "DELLBUSDT"],
  ["PLTR", "PLTRBUSDT"],
];

const FALLBACK_TAPE: [string, string][] = [
  ["NVDA", "+0.4%"],
  ["MU", "+1.2%"],
  ["DELL", "+0.8%"],
  ["AVGO", "+0.6%"],
  ["TSLA", "-0.3%"],
  ["AAPL", "+0.2%"],
  ["MSFT", "+0.5%"],
  ["AMZN", "+0.3%"],
];

function Windows({ cols, rows, seed }: { cols: number; rows: number; seed: number }) {
  const cells = [];
  for (let i = 0; i < rows * cols; i++) {
    // Deterministic so server and client render the same lattice.
    const lit = (seed * 7 + i * 13) % 20 < 11;
    const tone = (seed + i) % 7 === 0 ? " cool" : (seed + i) % 4 === 0 ? " warm" : "";
    cells.push(<i key={i} className={`win${lit ? " on" : ""}${tone}`} aria-hidden />);
  }
  return <div className="wins" style={{ ["--cols" as string]: cols }}>{cells}</div>;
}

function useTape() {
  const [items, setItems] = useState<[string, string, number][]>(
    FALLBACK_TAPE.map(([s, p]) => [s, p, parseFloat(p) >= 0 ? 1 : -1]),
  );
  const [live, setLive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const symbols = encodeURIComponent(JSON.stringify(WATCH.map(([, sym]) => sym)));
    fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?symbols=${symbols}`)
      .then((res) => {
        if (!res.ok) throw new Error(`tape ${res.status}`);
        return res.json();
      })
      .then((rows: { symbol: string; lastPrice: string; priceChangePercent: string }[]) => {
        if (cancelled) return;
        const by = new Map(rows.map((r) => [r.symbol, r]));
        const next: [string, string, number][] = [];
        for (const [ticker, symbol] of WATCH) {
          const r = by.get(symbol);
          if (!r || !Number.isFinite(Number(r.lastPrice))) continue;
          const pct = Number(r.priceChangePercent) || 0;
          next.push([ticker, `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`, pct >= 0 ? 1 : -1]);
        }
        if (next.length > 0) {
          setItems(next);
          setLive(true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return { items, live };
}

function useDayNight(paused: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || paused) return;
    let raf = 0;
    // Start at midday so the city opens in full daylight, then drifts slowly.
    const DAY_MS = 240_000;
    const start = performance.now() - 0.45 * DAY_MS;
    const tick = (now: number) => {
      const t = ((now - start) % DAY_MS) / DAY_MS;
      const night = t < 0.2 || t > 0.83 ? 0.9 : t < 0.32 || t > 0.7 ? 0.35 : 0;
      rootRef.current?.style.setProperty("--night", night.toFixed(2));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);
  return rootRef;
}

function useFitScale() {
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.92);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => {
      const s = Math.min(1.0, el.clientWidth / 620);
      setScale(Math.max(0.45, s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { stageRef, scale };
}

export function CityLanding() {
  const [active, setActive] = useState<Building | null>(null);
  const [paused, setPaused] = useState(false);
  const { items, live } = useTape();
  const skyRef = useDayNight(paused);
  const { stageRef, scale } = useFitScale();
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (reduceMotion) setPaused(true);
  }, [reduceMotion]);

  const tape = [...items, ...items];

  return (
    <div ref={skyRef} className="city" style={{ ["--night" as string]: 0 }}>
      <div className="city-stars" aria-hidden />
      <div className="city-sky-orb city-sun" aria-hidden />
      <div className="city-sky-orb city-moon" aria-hidden />

      <section className="city-hero" aria-label="StockIntel market city">
        <div className="city-copy">
          <p className="label-mono city-eyebrow">Event-driven equity intelligence</p>
          <h1>Find the event before it becomes the price.</h1>
          <p className="city-lede">
            Name a ticker. StockIntel investigates the world behind it, buildouts, capex,
            suppliers, filings, footage, then checks the market to see if the thesis is
            priced in yet. Hover a building to lift its thesis.
          </p>
          <div className="city-cta">
            <Link to="/app" className="city-btn city-btn-solid">Run your first watch</Link>
            <Link to="/how-it-works" className="city-btn">How the loop works</Link>
          </div>
          <ul className="city-stats">
            <li>Evidence per edge</li>
            <li>Thesis first, price last</li>
            <li>Read-only market check</li>
          </ul>
          {active && (
            <div className="city-thesis" aria-live="polite">
              <p className="label-mono">{active.ticker} · thesis</p>
              <p><strong>{active.blurb}.</strong> {active.thesis}</p>
              <Link to="/app" className="city-thesis-link">{active.venue ? "Enter the app" : `Watch ${active.ticker} in the app`}</Link>
            </div>
          )}
        </div>

        <div ref={stageRef} className="city-stage" role="img" aria-label="Isometric market city, buildings are watched tickers">
          <div className="city-scene" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
            <div className="city-ground">
              {TREES.map(([x, y], i) => (
                <i key={i} className="city-tree" style={{ left: x, top: y }} aria-hidden />
              ))}
              {BUILDINGS.map((b, i) => (
                <div
                  key={b.ticker}
                  className="city-slot"
                  style={{ ["--x" as string]: `${b.x}px`, ["--y" as string]: `${b.y}px`, ["--w" as string]: `${b.w}px`, ["--d" as string]: `${b.d}px`, ["--h" as string]: `${b.h}px`, ["--c" as string]: b.c } as React.CSSProperties}
                >
                  <div className="city-shadow" aria-hidden />
                  <button
                    type="button"
                    className="city-b"
                    aria-label={`${b.ticker}, ${b.blurb}. ${b.thesis}`}
                    onMouseEnter={() => setActive(b)}
                    onFocus={() => setActive(b)}
                    onMouseLeave={() => setActive((cur) => (cur?.ticker === b.ticker ? null : cur))}
                    onClick={() => setActive(b)}
                  >
                    <span className="city-face city-south"><Windows cols={b.cols} rows={b.rows} seed={i + 1} /><i className="city-door" aria-hidden /></span>
                    <span className="city-face city-east"><Windows cols={Math.max(2, Math.round(b.cols * 0.8))} rows={b.rows} seed={i + 11} /></span>
                    <span className="city-face city-top">
                      <span className="city-tag"><b>{b.ticker}</b>{b.blurb}</span>
                    </span>
                  </button>
                  {b.venue && <div className="city-neon" aria-hidden>bStocks Exchange</div>}
                </div>
              ))}
              <i className="city-car city-car-x1" style={{ ["--cc" as string]: "#ff8a65" }} aria-hidden />
              <i className="city-car city-car-x2" style={{ ["--cc" as string]: "#5ec4b6" }} aria-hidden />
              <i className="city-car city-car-y1" style={{ ["--cc" as string]: "#f6d365" }} aria-hidden />
              <i className="city-car city-car-y2" style={{ ["--cc" as string]: "#8fa7ff" }} aria-hidden />
            </div>
          </div>
        </div>
      </section>

      <section className="city-loop" aria-label="How StockIntel thinks">
        <div className="city-loop-inner">
          <p className="label-mono">The loop</p>
          <h2>World, event, exposure, thesis, market check.</h2>
          <ol>
            <li><strong>Target.</strong> You name a ticker. Say NVDA.</li>
            <li><strong>Fan out.</strong> Ten specialists investigate everything around it, not the ticker itself.</li>
            <li><strong>Exposure.</strong> One buildout fans into GPUs, memory, servers, networking, power.</li>
            <li><strong>Thesis.</strong> Each thread carries its evidence, freshness, and what would invalidate it.</li>
            <li><strong>Market check.</strong> Only then, live Binance context says if the move is already priced.</li>
          </ol>
          <div className="city-cta">
            <Link to="/app" className="city-btn city-btn-solid">Enter the app</Link>
            <button type="button" className="city-btn" onClick={() => setPaused((v) => !v)} aria-pressed={paused}>
              {paused ? "Resume sky" : "Pause sky"}
            </button>
          </div>
        </div>
      </section>

      <div className="city-tape" aria-hidden>
        <div className="city-tape-track">
          {tape.map(([s, p, d], i) => (
            <span key={`${s}-${i}`}><b>{s}</b> <i className={d > 0 ? "up" : "down"}>{p}</i></span>
          ))}
          <span className="city-tape-note">{live ? "live · bStocks trade 24/7" : "illustrative · bStocks trade 24/7"}</span>
        </div>
      </div>
    </div>
  );
}
