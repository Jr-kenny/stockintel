/**
 * Prime Signals — Prime Layer's own first-party search agent.
 *
 * A production-grade reference connector: it registers on the grid like any
 * external developer agent, receives research commands, performs REAL research
 * against free public sources (Google News RSS + GDELT), extracts companies
 * showing expansion/construction/opening signals, and submits graded-ready
 * claims with verifiable source URLs.
 *
 *   bun run agents/prime-signals/index.ts [--port 8790]
 *
 * Env:
 *   PRIME_ORCHESTRATOR  orchestrator base URL (default http://localhost:8081)
 *   CONNECTOR_PORT      listener port (default 8790)
 *   CONNECTOR_WALLET    settlement address; a fresh wallet is generated if unset
 *   SIGNALS_GDELT       "off" disables the GDELT source (default on)
 */

import { ethers } from "ethers";

const ORCHESTRATOR = process.env["PRIME_ORCHESTRATOR"] ?? "http://localhost:8080";
const PORT = Number(process.env["CONNECTOR_PORT"] ?? 8798);
const GDELT_ENABLED = (process.env["SIGNALS_GDELT"] ?? "on").toLowerCase() !== "off";

const NAME = "verification — Verification — independently v";
const SPECIALTY =
  "Verification — independent confirmation of claims from alternate sources";

/**
 * This agent's beat: which sources it actually reads.
 *
 * The grid is only worth ten agents if the ten read ten different places.
 * When every agent hit the same Google News RSS the run produced nine copies
 * of one search, so corroboration was impossible by construction: you cannot
 * cross-check a source against itself. Each agent now owns a distinct beat and
 * the orchestrator does the joining.
 *
 * verification: Independent confirmation only. Wire services and public broadcasters, chosen because they are the least likely to be recycling the same syndicated copy as everyone else.
 */
const BEAT = {
  googleNews: true,
  gdelt: true,
  edgar: true,
  /** Publisher domains to restrict news to. Empty = no restriction. */
  domains: [
    "apnews.com",
    "reuters.com",
    "bbc.com",
    "npr.org",
  ] as string[],
  /** Extra query suffixes that aim the beat at this agent's subject matter. */
  angles: [
    "confirmed official statement",
    "denied report disputes",
    "correction clarifies",
  ] as string[],
};

const wallet =
  process.env["CONNECTOR_WALLET"] ??
  new ethers.Wallet(ethers.Wallet.createRandom().privateKey).address;

// ─── Signal vocabulary ──────────────────────────────────────────────────────

/** Title-level verbs/phrases that indicate a company's situation is CHANGING. */
const SIGNAL_RE =
  /\b(expansion|expand[s]?|opens?|opening|inaugurat\w*|commission\w*|groundbreak\w*|breaks ground|broke ground|construction|to build|building|set to open|flagship|launch(es|ed)?|unveil\w*|acquir(es|ed)?|acquisition|merger|invest(s|ed|ment)?|funding|raise[sd]?|refurbish\w*|renovat\w*|guidance|forecast|downgrade|upgrade|buyback|dividend|split|contract|partnership|approval|clearance|filing|probe|lawsuit|breach|outage|recall|shortage|backlog|capex|tariff|sanction)\b/i;

const STOPWORDS = new Set(
  (
    "a an and are as at be been by for find from has have how i in into is it its me my of on " +
    "or our sell selling show that the their them they this to us want was we what which who " +
    "will with you your become becoming likely need needs companies company business businesses " +
    "give tell looking show showing evidence real some just about across between more most new " +
    "can could should would were than then when where while who's let's " +
    // Framing verbs: an instruction to the grid, never the subject of the search.
    // "Watch NVDA: ..." used to make "watch" the leading EDGAR full-text topic.
    "watch watching monitor monitoring track tracking follow following " +
    // Generic analytical filler. EDGAR takes only the first two topic words, so
    // one of these in slot two spends a primary-source lookup on noise, and the
    // relevance gate is a substring match that waves through anything containing
    // "change" or "value". Subject-bearing terms (export, supply, controls) stay.
    "happening happen happens materially material world worldwide value values " +
    "change changes changing matter matters currently anything something everything " +
    "latest update updates thing things going really actually"
  ).split(" "),
);

/**
 * Words that look like proper nouns in headlines but are places, people,
 * nationalities or news-desk furniture — never a company we can name.
 * Deliberately GLOBAL: the grid sources worldwide, not one region.
 */
const NOT_A_COMPANY = new Set(
  (
    "nigeria nigerian nigerians lagos abuja ghana ghanaian kenya kenyan nairobi africa african " +
    "egypt egyptian cairo southafrica johannesburg europe european america american british " +
    "london dubai asia asian ogun ogunstate ibadan kano abia rivers kaduna enugu anambra delta " +
    "oyo oyoState kwara osun ondo edo katsina sokoto borno yobe adamawa taraba benue plateau " +
    "nasarawa niger zamfara kebbi jigawa gombe ekiti china chinese chineseaided ecowas " +
    "tinubu obi atiku buhari president minister governor senate house government federal state whitmer pritzker wdrb wave forbes natureworks moes cornerstone grand opening video channel live breaking " +
    "updated breaking exclusive analysis opinion report reports video photos watch " +
    "monday tuesday wednesday thursday friday saturday sunday january february march april " +
    "may june july august september october november december today yesterday tomorrow " +
    "usa uk britain france french germany german india indian brazil canadian canada " +
    "australia australian japan japanese indonesia indonesian vietnam vietnamese mexico " +
    "spain spanish italy italian turkey turkish uae saudi emirates russia russian ukraine " +
    "israel israeli gaza iran iraq syria pakistan bangladesh philippines malaysia singapore " +
    "texas california florida york jersey ceo cfo coo founder chairman director"
  ).split(" "),
);

/** Bare headline verbs — a candidate containing one is a fragment, not a name. */
const HEADLINE_VERBS = new Set(
  (
    "launches launched launch opens opened opening unveils unveiled moves moved says said " +
    "plans planned begins began begins signs signed gets got wins won hosts hosted faces faced " +
    "enhancing enhance expands expanded grows growing rises rising falls falling cuts cutting " +
    "approves approves rejects joins joins leads led takes took sets set targets targets"
  ).split(" "),
);

/** Generic nouns — alone, they are commodities or sectors, never a company. */
const GENERIC_SINGLE_NOUNS = new Set(
  (
    "oil gas gold power energy cement bank banks hotel hotels factory factories plant plants " +
    "sugar flour steel mine mines port ports road roads bridge bridges estate estates " +
    "government ministry agency authority commission council association union group"
  ).split(" "),
);

type Evidence = { item: string; source: string; observed: string };
/**
 * What a collector submits. `confidence` is always 0 and stays on the wire only
 * so older orchestrators parse; judgment is the orchestrator's job.
 */
type Claim = { company: string; claim: string; confidence: number; evidence: Evidence[]; contact?: string };
type ResearchCommand = {
  command_id: string;
  inquiry_id: string;
  question: string;
  scope: { category?: string; geography?: string };
  hypotheses?: { label: string; searchHints: string[]; signals: string[]; whatToVerify?: string[] }[];
  investigation?: unknown;
  window_seconds: number;
  submit_url: string;
  /** Orchestrator memory: broadcast brief plus rechecks assigned to this agent. */
  memory_brief?: string;
  memory_recheck?: {
    followup_id: number;
    company: string;
    agent_id: string;
    note: string;
    prior_claim: string | null;
  }[];
};

// ─── Query building ─────────────────────────────────────────────────────────

/**
 * Aim a query at this agent's beat.
 *
 * Two levers: `angles` appends subject-matter terms so a procurement agent asks
 * about tenders where a person-role agent asks about appointments, and `domains`
 * restricts news to the publishers that actually cover this beat. Without these
 * the beat config would be decorative and every agent would resolve to the same
 * search string again.
 */
function aim(query: string, angleIndex: number): string {
  const parts = [query];
  if (BEAT.angles.length > 0) {
    parts.push(BEAT.angles[angleIndex % BEAT.angles.length]!);
  }
  if (BEAT.domains.length > 0) {
    parts.push(BEAT.domains.map((d) => `site:${d}`).join(" OR "));
  }
  return parts.join(" ").trim();
}

function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Vocabulary from everything the orchestrator sends beyond the question:
 * hypothesis verify lists, the shared investigation (open questions and
 * known entities), and the memory brief. The relevance gate only knows the
 * words it is given, so without this a briefed name reads as noise and the
 * orchestrator briefs nobody.
 */
function extraVocabulary(cmd: ResearchCommand): string[] {
  const out: string[] = [];
  for (const h of cmd.hypotheses ?? []) {
    out.push(...wordsOf((h.whatToVerify ?? []).join(" ")));
  }
  const inv = cmd.investigation as null | {
    openQuestions?: unknown;
    entities?: unknown;
  };
  if (inv && typeof inv === "object") {
    if (Array.isArray(inv.openQuestions)) {
      for (const q of inv.openQuestions) {
        if (typeof q === "string") out.push(...wordsOf(q));
      }
    }
    if (Array.isArray(inv.entities)) {
      for (const e of inv.entities) {
        const name = (e as { name?: unknown }).name;
        if (typeof name === "string") out.push(...wordsOf(name));
      }
    }
  }
  if (cmd.memory_brief) out.push(...wordsOf(cmd.memory_brief));
  return Array.from(new Set(out)).slice(0, 40);
}

/** Targeted re-checks assigned to this agent become beat-aimed queries. */
function recheckQueries(cmd: ResearchCommand): string[] {
  const out: string[] = [];
  for (const r of (cmd.memory_recheck ?? []).slice(0, 2)) {
    const about = wordsOf(r.prior_claim ?? r.note).slice(0, 4).join(" ");
    const q = `${r.company} ${about}`.trim();
    if (q) out.push(q);
  }
  return out;
}

function buildQueries(cmd: ResearchCommand): string[] {
  const out: string[] = [];
  // Hypotheses-aware: use the orchestrator's search hints first — they already encode
  // exposure-chain reasoning (events, counterparties, filings), not just keywords.
  if (cmd.hypotheses?.length) {
    const hints = cmd.hypotheses.flatMap((h) => h.searchHints ?? []).filter(Boolean).slice(0, 6);
    if (hints.length >= 2) {
      const geo = cmd.scope.geography ? ` ${cmd.scope.geography}` : "";
      out.push(...hints.map((q, i) => aim(`${q}${geo}`.trim(), i)));
    }
  }
  if (out.length === 0) {
    const geo = cmd.scope.geography ?? "";
    const words = cmd.question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

    // Drop the geography word from the topic list so it isn't doubled up.
    const geoLower = geo.toLowerCase();
    const topicWords = words.filter((w) => w !== geoLower);
    const topic = Array.from(new Set(topicWords)).slice(0, 5).join(" ");

    const queries: string[] = [];
    if (topic && geo) queries.push(`${topic} ${geo}`);
    if (topic && !geo) queries.push(topic);
    if (queries.length === 0 && geo) queries.push(geo);
    // One query per angle so a multi-angle beat still covers its own ground when
    // the orchestrator sent no hints.
    const spread = BEAT.angles.length > 0 ? BEAT.angles.length : 1;
    const aimed = queries.flatMap((q) =>
      Array.from({ length: spread }, (_, i) => aim(q, i)),
    );
    out.push(...Array.from(new Set(aimed)).slice(0, Math.max(2, spread)));
  }
  // Assigned re-checks ride along as extra beat-aimed queries, capped so the
  // slow sources cannot blow the collection window.
  const rechecks = recheckQueries(cmd);
  rechecks.forEach((q, i) => {
    const aimed = aim(q, out.length + i);
    if (!out.includes(aimed)) out.push(aimed);
  });
  return Array.from(new Set(out)).slice(0, 8);
}

// ─── Sources ────────────────────────────────────────────────────────────────

type RawSignal = {
  title: string;
  link: string;
  publisherUrl: string | null;
  publishedAt: string; // ISO date (yyyy-mm-dd)
  /** "filing" = primary regulatory source, outranks news in scoring. */
  origin: "news" | "filing";
  /** EDGAR gives us the exact registrant name — skip headline extraction. */
  companyOverride?: string | null;
  /** The topic keyword this signal matched (for relevance gating). */
  topicMatched?: string | null;
};

async function fetchGoogleNews(query: string): Promise<RawSignal[]> {
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    "&hl=en-US&gl=US&ceid=US:en";
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; PrimeSignals/1.0)" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`google news ${res.status}`);
  const xml = await res.text();

  const signals: RawSignal[] = [];
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  for (const item of items.slice(0, 15)) {
    const title = tag(item, "title");
    const link = tag(item, "link");
    const pubDate = tag(item, "pubDate");
    const sourceUrl = item.match(/<source[^>]*url="([^"]+)"/)?.[1] ?? null;
    if (!title || !link) continue;
    signals.push({
      title,
      link,
      publisherUrl: sourceUrl,
      publishedAt: toDate(pubDate ?? "") ?? new Date().toISOString().slice(0, 10),
      origin: "news",
    });
  }
  return signals;
}

async function fetchGdelt(query: string): Promise<RawSignal[]> {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
    encodeURIComponent(query) +
    "&mode=ArtList&maxrecords=15&format=json&timespan=7d";
  await sleep(5_200); // GDELT asks for 1 request / 5s
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`gdelt ${res.status}`);
  const text = await res.text();
  if (!text.startsWith("{")) throw new Error("gdelt rate limited");
  const data = JSON.parse(text) as {
    articles?: { title?: string; url?: string; seendate?: string; domain?: string }[];
  };
  return (data.articles ?? [])
    .filter((a) => a.title && a.url)
    .map((a) => ({
      title: a.title!,
      link: a.url!,
      publisherUrl: a.domain ? `https://${a.domain}` : null,
      // seendate format: 20260823T091500Z
      publishedAt: toDate(a.seendate ?? "") ?? new Date().toISOString().slice(0, 10),
      origin: "news" as const,
    }));
}

/**
 * SEC EDGAR full-text search — PRIMARY-source signals, free, no key.
 * Companies disclose expansions, new facilities and material deals in 8-K
 * filings; these outrank any news story because they come from the company
 * itself under legal penalty. Requires a descriptive User-Agent per SEC policy.
 */
const EDGAR_UA =
  process.env["EDGAR_USER_AGENT"]?.trim() ||
  "PrimeLayer-Signals/1.0 (research; contact@prime-layer.example)";

async function fetchEdgar(topics: string[]): Promise<RawSignal[]> {
  const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const signals: RawSignal[] = [];

  for (const topic of topics.slice(0, 2)) {
    const url =
      "https://efts.sec.gov/LATEST/search-index?q=" +
      encodeURIComponent(topic) +
      `&dateRange=custom&startdt=${since}&enddt=${today}&forms=8-K&size=20`;
    const res = await fetch(url, {
      headers: { "user-agent": EDGAR_UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`edgar ${res.status}`);
    const data = JSON.parse(await res.text()) as {
      hits?: {
        hits?: {
          _source?: {
            display_names?: string[];
            ciks?: number[];
            file_date?: string;
            form?: string;
          };
          _id?: string; // "ACCESSION_NO:filename.htm"
        }[];
      };
    };
    for (const hit of data.hits?.hits ?? []) {
      const src = hit._source;
      // EDGAR display names append "(TICKERS) (CIK …)" — strip parentheticals.
      const rawName = src?.display_names?.[0] ?? "";
      const company = rawName
        .replace(/\s*\([^)]*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const cik = src?.ciks?.[0];
      const [accession, filename] = (hit._id ?? "").split(":");
      if (!company || !cik || !accession || !filename) continue;
      const link = `https://www.sec.gov/Archives/edgar/data/${cik}/${accession.replace(/-/g, "")}/${filename}`;
      signals.push({
        title: `${company} files ${src?.form ?? "8-K"} citing ${topic}`,
        link,
        publisherUrl: "https://www.sec.gov",
        publishedAt: src?.file_date ?? today,
        origin: "filing",
        companyOverride: cleanName(company),
        topicMatched: topic,
      });
    }
  }
  return signals;
}

// ─── Extraction ─────────────────────────────────────────────────────────────

/** Pull the company name out of a headline using common news patterns. */
function extractCompany(title: string): string | null {
  const head = title.replace(/\s+-\s+[^-]+$/, "").trim(); // drop "- Publisher"

  const patterns: RegExp[] = [
    /^(?:Nigeria's|Ghana's|Kenya's|South Africa's|Egypt's)?\s*(.{3,60}?)\s+(?:opens?|opened|inaugurates?|commissions?|unveils?|launches|launched|expands?|begins|started?|breaks ground|broke ground|debuts)\b/i,
    /^(.{3,60}?)\s+(?:to|set to|will)\s+(?:open|build|construct|launch|expand|commission|establish)\b/i,
    /\$(?:[\d,.]+)\s*(?:bn|billion|m|million)?\s+(?:investment|loan|facility|deal|fund)\s+(?:in|for|to)\s+(.{3,60}?)(?:\s*[,-–]|\s|$)/i,
    /^(.{3,60}?)\s+(?:has|have)\s+(?:opened|launched|started|begun|completed|announced)\b/i,
  ];
  for (const re of patterns) {
    const m = head.match(re);
    if (m?.[1]) {
      const name = cleanName(m[1]);
      if (name) return name;
    }
  }
  // Pattern verbs failed — only trust the capitalised-run fallback when a
  // strong signal verb is present in the headline.
  if (!SIGNAL_RE.test(head)) return null;
  const cap = head.match(/\b([A-Z][A-Za-z&.'-]+(?:\s+[A-Z][A-Za-z&.'-]+){0,3})/);
  return cap ? cleanName(cap[1]) : null;
}

function cleanName(raw: string): string | null {
  // Ads are not companies. Sponsored content never becomes an entity.
  if (/[\[(]?sponsored\s+content[\])]?/i.test(raw)) return null;
  const name = raw
    .replace(/^\s*[\[(][^\]\)]{0,40}[\]\)]\s*/, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/\s+(?:as|and|with|for|in|at|to|by|from)$/i, "")
    .replace(/[.,;:]$/, "")
    .trim();
  if (name.length < 3 || name.length > 70) return null;
  // Reject obvious non-companies: gov persons, media channels, events
  if (/\b(gov\.?|governor|president|minister|whitmer|pritzker|wdrb|wave|forbes|natureworks|moes|grand\s+opening|cornerstone\s+ceremony)\b/i.test(name)) return null;
  if (name.includes("+")) return null;
  if (/^(news|update|report|weekly|daily|breaking)$/i.test(name)) return null;

  // A fragment starting with a preposition or conjunction ("From Crude",
  // "If the GCC aims") is a clause, not a name.
  if (/^(from|if|to|as|at|on|in|with|after|before|during|while|when|where|how|why|what|and|but|or|for|by|of|the)\b/i.test(name)) return null;
  const tokens = name.toLowerCase().split(/\s+/);
  const meaningful = tokens.filter((t) => !/^(of|the|and|for|in|new)$/i.test(t) && t.length > 1);
  if (meaningful.length === 0) return null;
  // Every meaningful token is a place/person/news-desk word -> not a company.
  if (meaningful.every((t) => NOT_A_COMPANY.has(t.replace(/[^a-z]/g, "")))) return null;
  // A headline verb inside the candidate means we grabbed a clause fragment.
  if (meaningful.some((t) => HEADLINE_VERBS.has(t))) return null;
  // Possessive endings ("Nigeria's") betray a place-led fragment.
  if (/^[a-z]+'s$/i.test(tokens[0] ?? "")) return null;
  // A lone generic noun ("Oil", "Hotel") is a sector, not an operator.
  if (meaningful.length === 1 && GENERIC_SINGLE_NOUNS.has(meaningful[0]!.replace(/[^a-z]/g, ""))) {
    return null;
  }
  return name;
}

/**
 * Local ordering only: which of several headlines about the same entity to lead
 * with, and which evidence to attach first. This is NOT a confidence claim and
 * never leaves the agent. Claim quality is judged by the orchestrator in
 * source-quality.ts, where the whole evidence set is visible.
 */
function scoreSignal(signal: RawSignal): number {
  // Primary regulatory filings start high — the company said it itself.
  let confidence = signal.origin === "filing" ? 0.78 : 0.58;
  const t = signal.title;
  // Concrete capacity or money mentioned -> stronger signal.
  if (
    /\$\s?[\d,.]+/.test(t) ||
    /\b\d{3,}\s*(billion|million|thousand)\b/i.test(t)
  ) {
    confidence += 0.12;
  }
  // Fresh observations score higher than stale ones.
  const ageDays = (Date.now() - Date.parse(signal.publishedAt)) / 86_400_000;
  if (Number.isFinite(ageDays)) {
    if (ageDays <= 2) confidence += 0.08;
    else if (ageDays <= 7) confidence += 0.04;
  }
  return Math.min(0.92, Number(confidence.toFixed(2)));
}

/**
 * Topic relevance gate — hypothesis-aware.
 * When the orchestrator supplied hypotheses, a signal is relevant if it
 * matches EITHER the watched ticker topic OR any hypothesis signal vocabulary
 * (expansion/construction/tender etc.). This keeps the filter honest for
 * indirect exposure: a counterparty buildout still matters to the ticker even when
 * the headline never names it.
 */
function isRelevant(title: string, topicWords: string[], hypotheses?: { signals?: string[] }[]): boolean {
  const lower = title.toLowerCase();
  if (topicWords.some((w) => lower.includes(w))) return true;
  // Hypothesis signal match — e.g. "new facility announced" against title
  if (hypotheses?.length) {
    const sigWords = hypotheses.flatMap((h) => h.signals ?? []).join(" ").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    const sigSet = new Set(sigWords);
    // Also check SIGNAL_RE as generic expansion vocabulary fallback
    if (typeof SIGNAL_RE !== "undefined" && SIGNAL_RE.test(title)) return true;
    if ([...sigSet].some((w) => lower.includes(w))) return true;
  }
  return false;
}

/** Merge key: normalised company name across ALL sources. */
function mergeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(group|plc|ltd|limited|inc|incorporated|corp|corporation|company|holdings|international|intl)\b/g,
      "",
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toClaims(signals: RawSignal[], cmd: ResearchCommand): Claim[] {
  // Topic vocabulary from the actual question plus everything briefed —
  // used for relevance gating.
  const geo = cmd.scope.geography ?? "";
  const topicWords = [
    ...cmd.question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w) && w !== geo.toLowerCase()),
    ...extraVocabulary(cmd),
  ];

  // Pass 1 — collect qualifying signals per merged company.
  interface Bucket {
    name: string;
    best: RawSignal;
    all: RawSignal[];
    filingSeen: boolean;
  }
  const buckets = new Map<string, Bucket>();

  for (const s of signals) {
    // Filing-derived signals carry their registrant; news needs extraction.
    const company = s.companyOverride ?? extractCompany(s.title);
    if (!company) continue;

    // Relevance: filings matched the query by construction; news must prove it.
    if (!s.companyOverride && !isRelevant(s.title, topicWords, cmd.hypotheses)) continue;
    if (s.companyOverride && s.topicMatched && !isRelevant(company, [s.topicMatched])) {
      // registrant name doesn't contain the topic — that's fine, the FILING
      // text did; keep it.
    }

    const key = mergeKey(company);
    if (!key) continue;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.all.push(s);
      bucket.filingSeen ||= s.origin === "filing";
      if (scoreSignal(s) > scoreSignal(bucket.best)) bucket.best = s;
    } else {
      buckets.set(key, {
        name: company,
        best: s,
        all: [s],
        filingSeen: s.origin === "filing",
      });
    }
  }

  // Pass 2 — one claim per company, every distinct source attached as evidence.
  const claims: Claim[] = [];
  for (const bucket of buckets.values()) {
    const seenClusters = new Set<string>();
    const evidence: Evidence[] = [];
    for (const s of bucket.all.sort((a, b) => scoreSignal(b) - scoreSignal(a))) {
      // Filings: cite the exact document. News: cite the publisher (the
      // article link is a redirect; the domain is the stable cluster key).
      const source = s.origin === "filing" ? s.link : (s.publisherUrl ?? s.link);
      const cluster = sourceClusterKey(source);
      if (seenClusters.has(cluster)) continue;
      seenClusters.add(cluster);
      evidence.push({ item: s.title, source, observed: s.publishedAt });
      if (evidence.length >= 4) break;
    }

    // No confidence, no interpretation. This agent is a collector: it reports
    // what it found and where, and the orchestrator judges it.
    //
    // It used to score its own findings, and grade.ts read that number straight
    // into the `quality` dimension, so a regex scraper's guess became part of
    // the analyst's weighting. It also wrote `whyRelevant` from four hardcoded
    // templates keyed off a headline verb, which produced confident sentences
    // about exposure paths it had not traced. Quality now comes from
    // source-quality.ts (publisher tier, freshness, independent corroboration)
    // and interpretation from the connection pass, which sees every event at
    // once instead of one headline in isolation.
    //
    // The field stays on the wire as a fixed zero so older orchestrators still
    // parse a submission from an updated agent.
    const confidence = 0;

    // Contact: when an individual is the business (X/Medium/LinkedIn post tied 1:1
    // to the name), the source itself is the contact — only when sure.
    let contact: string | undefined;
    if (evidence.length <= 2 && evidence[0]?.source) {
      try {
        const host = new URL(evidence[0].source).hostname.replace(/^www\./, "").toLowerCase();
        const isSocial =
          ["x.com", "twitter.com", "medium.com", "linkedin.com", "youtube.com", "instagram.com", "tiktok.com"].includes(host) ||
          host.endsWith(".medium.com");
        if (isSocial) contact = evidence[0].source;
      } catch {}
    }

    claims.push({
      company: bucket.name,
      claim: bucket.best.title.replace(/\s+-\s+[^-]+$/, "").slice(0, 500),
      confidence,
      evidence,
      ...(contact ? { contact } : {}),
    });
    if (claims.length >= 8) break;
  }

  // Freshest first. Ordering by a self-assigned score is exactly what this
  // agent no longer does, and observation date is a fact rather than a judgment.
  claims.sort((a, b) =>
    (b.evidence[0]?.observed ?? "").localeCompare(a.evidence[0]?.observed ?? ""),
  );
  return claims;
}

export function sourceClusterKey(source: string): string {
  const raw = source.trim();
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "") || "/";
    const tracking = new Set([
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "fbclid",
      "gclid",
      "msclkid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "_hsenc",
      "_hsmi",
      "yclid",
    ]);
    const kept: [string, string][] = [];
    u.searchParams.forEach((v, k) => {
      if (!tracking.has(k.toLowerCase()) && !k.toLowerCase().startsWith("utm_")) kept.push([k, v]);
    });
    kept.sort(([a], [b]) => a.localeCompare(b));
    const query = kept.length ? `?${kept.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${host}${path}${query}`.toLowerCase();
  } catch {
    return source.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

// ─── Grid plumbing ──────────────────────────────────────────────────────────

let agentId: string | null = null;

// Public URL other hosts use to reach this agent (registered with the
// orchestrator). Defaults to localhost for local dev grids.
const PUBLIC_URL = process.env["CONNECTOR_PUBLIC_URL"] ?? `http://localhost:${PORT}`;

async function register(): Promise<string> {
  const res = await fetch(`${ORCHESTRATOR}/api/agents/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: NAME,
      specialty: SPECIALTY,
      endpoint: `${PUBLIC_URL}/claim`,
      wallet,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json()) as { agent_id?: string; error?: string };
  if (!res.ok || !body.agent_id) {
    throw new Error(`registration failed: ${body.error ?? res.status}`);
  }
  return body.agent_id;
}

async function researchAndSubmit(command: ResearchCommand) {
  try {
    const queries = buildQueries(command);
    console.log(`→ CMD ${command.command_id} · queries:`, queries);
    console.log(
      `  intake: ${command.memory_brief ? "brief+" : ""}${command.memory_recheck?.length ?? 0} recheck(s), ` +
        `${command.hypotheses?.flatMap((h) => h.whatToVerify ?? []).length ?? 0} verify item(s)`,
    );

    const signals: RawSignal[] = [];
    // Google News in parallel: the old serial loop waited out every 12s
    // timeout back to back, so 6 queries could stall an agent past the
    // wave-one window on its own.
    if (BEAT.googleNews) {
      const newsResults = await Promise.allSettled(queries.map((q) => fetchGoogleNews(q)));
      for (const r of newsResults) {
        if (r.status === "fulfilled") signals.push(...r.value);
        else console.warn("  google news failed:", r.reason instanceof Error ? r.reason.message : r.reason);
      }
    }
    // GDELT asks for 1 request per 5s, so it stays serial — but only on the
    // first two queries. Fanning all eight queries at it cost ~40s of sleep
    // per wave for headlines the broad sweep rarely needed.
    if (BEAT.gdelt && GDELT_ENABLED) {
      for (const q of queries.slice(0, 2)) {
        try {
          signals.push(...(await fetchGdelt(q)));
        } catch (err) {
          console.warn("  gdelt failed:", err instanceof Error ? err.message : err);
        }
      }
    }
    // Primary sources: SEC filings mentioning the inquiry's core topics.
    const topicWords = command.question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4 && !STOPWORDS.has(w));
    if (BEAT.edgar && topicWords.length > 0) {
      try {
        signals.push(...(await fetchEdgar(topicWords)));
        console.log("  edgar signals fetched");
      } catch (err) {
        console.warn("  edgar failed:", err instanceof Error ? err.message : err);
      }
    }
    console.log(`  raw signals: ${signals.length}`);

    const claims = toClaims(signals, command);
    if (claims.length === 0) {
      await decline(command);
      return;
    }

    const res = await fetch(command.submit_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command_id: command.command_id,
        inquiry_id: command.inquiry_id,
        agent_id: agentId,
        claims,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json();
    if (res.ok) {
      console.log(`✓ submitted ${claims.length} claim(s):`);
      for (const c of claims) {
        console.log(
          `    • ${c.company} · ${c.evidence[0]?.observed ?? "undated"} ← ${c.evidence[0]?.source}`,
        );
      }
    } else {
      console.warn("✗ submission rejected:", body);
    }
  } catch (err) {
    console.error("research failure:", err);
  }
}

async function decline(command: ResearchCommand) {
  await fetch(command.submit_url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command_id: command.command_id,
      inquiry_id: command.inquiry_id,
      agent_id: agentId,
      claims: [],
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
  console.log("✗ declined (no qualifying signals)");
}

// ─── Utils ──────────────────────────────────────────────────────────────────

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  if (!m?.[1]) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function toDate(raw: string): string | null {
  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    return iso;
  }
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Boot ───────────────────────────────────────────────────────────────────

await main();

async function main() {
  agentId = await register();
  console.log(`✓ ${NAME} registered · id=${agentId} · wallet=${wallet}`);

  // Public URL other hosts use to reach this agent (registered with the
  // orchestrator). Defaults to localhost for local dev grids.
  Bun.serve({
    port: PORT,
    hostname: "0.0.0.0",
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "POST" && url.pathname === "/claim") {
        const command = (await request.json()) as ResearchCommand;
        void researchAndSubmit(command); // async; window stays open
        return Response.json({ accepted: true });
      }
      if (url.pathname === "/health") {
        return Response.json({ ok: true, agent: NAME, agentId });
      }
      return new Response("prime-signals connector", { status: 200 });
    },
  });

  console.log(`✓ listening on ${PUBLIC_URL}/claim`);
}
