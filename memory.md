# Memory

## 2026-09-05 — De-hardcode agents, cost disclosure
- User correctly called out my residue scrub as checklist swapping (hotel to fab/datacenter) instead of checklist removal. Fixed properly: SIGNAL_RE is now generic change verbs only across all 10 agents, sector query template deleted (topic or hypothesis hints drive, geo-only fallback), capacity bonus is money plus plain magnitudes (billion/million/thousand). Reasoning objective stays in orchestrator hypotheses plus soul.md. Headline guards kept, they are structural not sectoral.
- Cost: 0G models now glm-5 primary plus deepseek-v4-flash fallback (defaults changed from zai-org/GLM-5-FP8, disclosed this turn). Catalog USD per token: glm-5 in 0.00000075 out 0.0000024, deepseek flash in 0.000000138 out 0.000000275. Test spend this session roughly 15 calls near 45k tokens blended, well under $0.50. Zen spend zero (all calls failed or free). OpenRouter unused, no key. Rule going forward: no model switches and no live spend without asking first.
- Production still serves pre-session build. Push plus Vercel deploy pending remote URL.
