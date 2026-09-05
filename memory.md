# Memory

## 2026-09-05 — Launch fixes
- Thesis writer was failing on empty, fenced, truncated router output. Root cause was chatJson throwing before coerce could salvage. Fixed by trimming payload to top 6 companies, 600 char claims, 3 sources, 60s timeout, 2200 max tokens, plus salvage of rawContent on throw. Fallback now carries verdicts and exposure chain voice so it reads as thesis, not grouped clusters.
- City HTML was reference only but routed as static `/city/index.html`. Built real React landing at `/` as `src/components/city/CityLanding.tsx` plus `city.css`. Buildings lift on hover and focus with thesis, tape reads live Binance with fallback, respects reduced motion. Fixed SiteNav brand Runintel to StockIntel.
- Build passes with `bun run build`.
