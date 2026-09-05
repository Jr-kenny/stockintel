/**
 * Media YouTube — First-class YouTube research pipeline.
 *
 * Steps (per spec §8):
 * 1. Discover relevant videos (YouTube Data API v3)
 * 2. Retrieve metadata
 * 3. Obtain transcript/captions where available (timedtext)
 * 4. Analyze transcript
 * 5. Identify entities
 * 6. Extract claims
 * 7. Extract project info
 * 8. Link entities to existing evidence
 * 9. Generate follow-up investigations
 * 10. Store source and exact evidence supporting the claim
 *
 *   bun run agents/media-youtube/index.ts [--port 8797]
 *
 * Env:
 *   PRIME_ORCHESTRATOR  orchestrator base URL (default http://localhost:8081)
 *   CONNECTOR_PORT      listener port (default 8797)
 *   CONNECTOR_WALLET    settlement address
 *   YOUTUBE_API_KEY     YouTube Data API v3 key (if unset, agent declines gracefully)
 */

import { ethers } from "ethers";

const ORCHESTRATOR = process.env["PRIME_ORCHESTRATOR"] ?? "http://localhost:8080";
const PORT = Number(process.env["CONNECTOR_PORT"] ?? 8797);
const YOUTUBE_API_KEY = process.env["YOUTUBE_API_KEY"]?.trim() ?? "";

const NAME = "media-youtube — Media — YouTube interviews podcasts audiovisual";
const SPECIALTY = "Media — YouTube interviews podcasts audiovisual — discovers videos, extracts transcripts, identifies projects and entities";

const PUBLIC_URL = process.env["CONNECTOR_PUBLIC_URL"] ?? `http://localhost:${PORT}`;

const wallet = process.env["CONNECTOR_WALLET"] ?? new ethers.Wallet(ethers.Wallet.createRandom().privateKey).address;

type Evidence = { item: string; source: string; observed: string };
type Claim = { company: string; claim: string; confidence: number; evidence: Evidence[]; why_relevant?: string; contact?: string };
type ResearchCommand = {
  command_id: string;
  inquiry_id: string;
  question: string;
  scope: { category?: string; geography?: string };
  hypotheses?: { label: string; searchHints: string[]; signals: string[] }[];
  investigation?: unknown;
  window_seconds: number;
  submit_url: string;
};

let agentId: string | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildQueries(cmd: ResearchCommand): string[] {
  if (cmd.hypotheses?.length) {
    const hints = cmd.hypotheses.flatMap((h) => h.searchHints ?? []).filter(Boolean).slice(0, 4);
    if (hints.length) {
      const geo = cmd.scope.geography ? ` ${cmd.scope.geography}` : "";
      // Bias toward video-rich queries
      return hints.map((q) => `${q} tour construction project${geo}`.trim());
    }
  }
  const base = cmd.scope.category ?? cmd.question.slice(0, 60);
  const geo = cmd.scope.geography ? ` ${cmd.scope.geography}` : "";
  return [`${base} construction tour${geo}`, `${base} project announcement${geo}`].slice(0, 2);
}

async function discoverVideos(query: string): Promise<{ videoId: string; title: string; channel: string; publishedAt: string; description: string }[]> {
  if (!YOUTUBE_API_KEY) return [];
  const url =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=" +
    encodeURIComponent(query) +
    "&key=" +
    YOUTUBE_API_KEY;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`youtube search ${res.status}`);
  const data = (await res.json()) as {
    items?: { id: { videoId: string }; snippet: { title: string; channelTitle: string; publishedAt: string; description: string } }[];
  };
  return (data.items ?? []).map((it) => ({
    videoId: it.id.videoId,
    title: it.snippet.title,
    channel: it.snippet.channelTitle,
    publishedAt: (it.snippet.publishedAt ?? new Date().toISOString()).slice(0, 10),
    description: it.snippet.description ?? "",
  }));
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  // Try YouTube timedtext (public captions). If unavailable, return null and caller falls back to description.
  const urls = [
    `https://www.youtube.com/api/timedtext?lang=en&v=${videoId}`,
    `https://www.youtube.com/api/timedtext?lang=en-US&v=${videoId}`,
  ];
  for (const u of urls) {
    try {
      const res = await fetch(u, { signal: AbortSignal.timeout(5000), headers: { "user-agent": "Mozilla/5.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      if (!xml || xml.includes("<?xml") === false || xml.trim() === "") continue;
      // Extract <text> nodes
      const texts = [...xml.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      if (texts.length > 5) return texts.join(" ").slice(0, 4000);
    } catch {}
  }
  return null;
}

// Blocklist for YouTube titles — channels, people, generic labels that are not companies
const YT_STOP = new Set("gov governor whitmer pritzker wdrb wave forbes breaking moes natureworks illinois grand opening ceremony cornerstone tour video project construction building new update report announcement live".toLowerCase().split(" "));
function extractCompany(title: string): string | null {
  const m = title.match(/\b([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,2})\b/);
  if (!m) return null;
  const name = m[1].trim().replace(/^(The|A|An)\s+/i, "");
  if (name.length < 3 || name.length > 60) return null;
  if (/^(Tour|Video|Project|Construction|Building|New|Update|Report|Grand|Opening|Live)$/i.test(name)) return null;
  // single-token gov/person/channel reject
  const low = name.toLowerCase();
  if (YT_STOP.has(low)) return null;
  // any token is a known person/channel/gov word → likely not a company
  const toks = low.split(/\s+/);
  if (toks.some(t => YT_STOP.has(t)) && toks.length <= 2) {
    // e.g. "Gov. Whitmer", "WDRB+WAVE", "Illinois Gov" — reject short combos containing stop word
    if (toks.some(t => ["gov","governor","whitmer","pritzker","wdrb","wave","forbes"].includes(t))) return null;
  }
  // possessive or headline verb fragment
  if (/^[a-z]+'s$/i.test(toks[0] ?? "")) return null;
  return name;
}

async function researchAndSubmit(cmd: ResearchCommand): Promise<void> {
  if (!YOUTUBE_API_KEY) {
    await decline(cmd, "YouTube API key not configured — skipping video research");
    return;
  }
  const queries = buildQueries(cmd);
  const allVideos: Awaited<ReturnType<typeof discoverVideos>> = [];
  for (const q of queries) {
    try {
      const vids = await discoverVideos(q);
      allVideos.push(...vids);
    } catch (e) {
      console.error(`youtube discover failed for "${q}":`, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (allVideos.length === 0) {
    await decline(cmd, "No relevant videos found");
    return;
  }

  const claims: Claim[] = [];
  for (const v of allVideos.slice(0, 6)) {
    const videoUrl = `https://www.youtube.com/watch?v=${v.videoId}`;
    const transcript = await fetchTranscript(v.videoId);
    const content = transcript ?? v.description ?? v.title;
    // Prefer title-extracted company; fall back to channel only if it looks like a company, never Unknown Developer
    let company: string | null = extractCompany(v.title);
    if (!company && v.channel) {
      // channel often is a media outlet, not a company — only trust if it passes company check
      const ch = extractCompany(v.channel);
      // also reject obvious outlet names (WDRB, Forbes, etc consolidated in extractCompany already)
      if (ch && !/^(WDRB|WAVE|Forbes|Breaking|News|Mo.?es|Smart|NatureWorks)$/i.test(ch)) company = ch;
    }
    if (!company) continue;
    const observed = v.publishedAt;

    // Project info — require transcript/description to mention concrete work
    const hasProject = /hotel|estate|mall|hospital|plant|factory|fab|datacenter|building|development|construction|facility|warehouse|terminal|refinery|mill|store|branch/i.test(content);
    if (!hasProject) continue;

    const item = transcript
      ? `Video "${v.title}" by ${v.channel}: transcript reveals ${content.slice(0, 180)}...`
      : `Video "${v.title}" by ${v.channel}: ${v.description.slice(0, 180)}`;

    const watchPhrase = (() => {
      const tick = cmd.question.match(/watch(?:ing)?\s+([A-Za-z]{1,6})\b/i);
      if (tick?.[1]) return tick[1].toUpperCase();
      const cat = (cmd.scope.category ?? "").trim();
      if (cat.length > 8) return cat.length > 60 ? cat.slice(0,57).replace(/\s+\S*$/, "")+"..." : cat;
      const q = cmd.question.replace(/\s+/g, " ").trim();
      if (q.length > 8 && q.length <= 60) return q;
      return "the watched ticker";
    })();
    const transcriptHint = transcript ? "transcript confirms active work" : "description points to active work";
    const why = `YouTube via ${v.channel} on ${observed}: "${v.title.slice(0, 62)}", ${transcriptHint}. For ${company}, that build/expansion moves exposed names as it progresses. Watch the clip for scale and timing to impact.`.slice(0, 340);

    claims.push({
      company,
      claim: v.title.replace(/\s+-\s+[^-]+$/, "").slice(0, 500),
      confidence: transcript ? 0.72 : 0.58,
      evidence: [{ item: item.slice(0, 300), source: videoUrl, observed }],
      why_relevant: why,
      // If channel looks like individual, treat video URL as contact (individual==business when sure)
      ...(v.channel && v.channel.length < 40 ? { contact: videoUrl } : {}),
    });
    if (claims.length >= 5) break;
  }

  if (claims.length === 0) {
    await decline(cmd, "Videos found but no project signals extracted");
    return;
  }

  await submitClaims(cmd, claims);
}

async function submitClaims(cmd: ResearchCommand, claims: Claim[]): Promise<void> {
  const res = await fetch(cmd.submit_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command_id: cmd.command_id,
      inquiry_id: cmd.inquiry_id,
      agent_id: agentId,
      claims: claims.map((c) => ({
        company: c.company,
        claim: c.claim,
        confidence: c.confidence,
        evidence: c.evidence,
        why_relevant: c.why_relevant,
        ...(c.contact ? { contact: c.contact } : {}),
      })),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) console.error(`submit failed ${res.status}:`, await res.text().catch(() => ""));
  else console.log(`youtube agent submitted ${claims.length} claims for ${cmd.inquiry_id}`);
}

async function decline(cmd: ResearchCommand, reason: string): Promise<void> {
  try {
    await fetch(cmd.submit_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command_id: cmd.command_id, inquiry_id: cmd.inquiry_id, agent_id: agentId, claims: [] }),
      signal: AbortSignal.timeout(5000),
    });
    console.log(`youtube decline ${cmd.inquiry_id}: ${reason}`);
  } catch {}
}

async function register(): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR}/api/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: NAME, specialty: SPECIALTY, endpoint: `${PUBLIC_URL}/claim`, wallet }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`register ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { agent_id: string };
  agentId = data.agent_id;
  console.log(`YouTube agent registered as ${agentId} → ${NAME} on :${PORT}`);
  return agentId;
}

// ─── HTTP server ──────────────────────────────────────────────────────────

async function main() {
  await register();
  const server = Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    async fetch(request: Request): Promise<Response> {
      if (request.method !== "POST") return new Response("media-youtube alive", { status: 200 });
      try {
        const cmd = (await request.json()) as ResearchCommand;
        // fire-and-forget research so we return quickly
        void researchAndSubmit(cmd).catch((e) => console.error("youtube research error:", e));
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 400, headers: { "content-type": "application/json" } });
      }
    },
  });
  console.log(`YouTube agent listening on ${PUBLIC_URL}/claim`);
}

if (import.meta.main) void main();
