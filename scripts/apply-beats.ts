/**
 * Apply per-agent source beats.
 *
 * The ten agents share one research body, which is fine, but they were also
 * sharing one SOURCE, which is not: nine agents hitting the same Google News
 * query produced eight distinct claims and made corroboration impossible.
 * This script rewrites each agent's BEAT block so the ten actually read ten
 * different places, then leaves the shared body alone.
 *
 * Idempotent: re-running replaces the BEAT block in place.
 * Run: bun scripts/apply-beats.ts
 */

type Beat = {
  googleNews: boolean;
  gdelt: boolean;
  edgar: boolean;
  domains: string[];
  angles: string[];
  note: string;
};

const BEATS: Record<string, Beat> = {
  "web-research": {
    googleNews: true,
    gdelt: true,
    edgar: true,
    domains: [],
    angles: [],
    note: "The generalist: broad news plus GDELT plus filings, no restriction. Something has to keep the wide net.",
  },

  "company-intel": {
    googleNews: true,
    gdelt: false,
    edgar: true,
    domains: ["reuters.com", "bloomberg.com", "ft.com", "wsj.com", "cnbc.com"],
    angles: ["earnings guidance capacity", "revenue segment disclosure", "capex plan"],
    note: "Company fundamentals from wire services and primary filings. EDGAR on, because a registrant's own 8-K outranks any story about it.",
  },

  "project-intel": {
    googleNews: true,
    gdelt: true,
    edgar: false,
    domains: ["datacenterdynamics.com", "constructiondive.com", "enr.com", "utilitydive.com"],
    angles: ["construction timeline milestone", "site permit approval", "capacity megawatt expansion"],
    note: "Physical buildout: datacenters, fabs, plants, grid. Trade press knows about a site months before the wires do.",
  },

  procurement: {
    googleNews: true,
    gdelt: false,
    edgar: true,
    domains: ["sam.gov", "ted.europa.eu", "govconwire.com", "defensenews.com"],
    angles: ["tender awarded contract value", "supply agreement signed", "purchase order framework"],
    note: "Contracts and tenders — the paperwork that transmits exposure down a supply chain before revenue shows up.",
  },

  "person-role": {
    googleNews: true,
    gdelt: false,
    edgar: true,
    domains: ["reuters.com", "bloomberg.com", "theinformation.com", "businessinsider.com"],
    angles: ["appointed chief executive hire", "executive departure resigns", "board appointment"],
    note: "Who decides. Leadership moves and hiring signal strategy shifts earlier than product news. EDGAR on for 8-K Item 5.02 officer changes.",
  },

  "social-signal": {
    googleNews: true,
    gdelt: true,
    edgar: false,
    domains: ["techcrunch.com", "theverge.com", "arstechnica.com", "semianalysis.com"],
    angles: ["engineers report hiring surge", "developer community reaction", "job postings team expansion"],
    note: "Intent before announcement: hiring surges, developer chatter, technical community reaction.",
  },

  verification: {
    googleNews: true,
    gdelt: true,
    edgar: true,
    domains: ["apnews.com", "reuters.com", "bbc.com", "npr.org"],
    angles: ["confirmed official statement", "denied report disputes", "correction clarifies"],
    note: "Independent confirmation only. Wire services and public broadcasters, chosen because they are the least likely to be recycling the same syndicated copy as everyone else.",
  },

  "prime-signals": {
    googleNews: true,
    gdelt: true,
    edgar: false,
    domains: [],
    angles: ["announces expansion investment", "breaks ground opens facility"],
    note: "Wide global sweep for change-of-state events. Deliberately unrestricted, the widest net on the grid.",
  },

  synthesis: {
    googleNews: true,
    gdelt: false,
    edgar: false,
    domains: ["semianalysis.com", "stratechery.com", "economist.com", "ft.com"],
    angles: ["analysis implications means for", "supply chain dependency risk"],
    note: "Analytical and second-order coverage — the pieces that already connect two events, useful raw material for the orchestrator's own connection pass.",
  },
};

function block(name: string, beat: Beat): string {
  const arr = (xs: string[]) =>
    xs.length === 0 ? "[]" : `[\n${xs.map((x) => `    ${JSON.stringify(x)},`).join("\n")}\n  ]`;
  return `/**
 * This agent's beat: which sources it actually reads.
 *
 * The grid is only worth ten agents if the ten read ten different places.
 * When every agent hit the same Google News RSS the run produced nine copies
 * of one search, so corroboration was impossible by construction: you cannot
 * cross-check a source against itself. Each agent now owns a distinct beat and
 * the orchestrator does the joining.
 *
 * ${name}: ${beat.note}
 */
const BEAT = {
  googleNews: ${beat.googleNews},
  gdelt: ${beat.gdelt},
  edgar: ${beat.edgar},
  /** Publisher domains to restrict news to. Empty = no restriction. */
  domains: ${arr(beat.domains)} as string[],
  /** Extra query suffixes that aim the beat at this agent's subject matter. */
  angles: ${arr(beat.angles)} as string[],
};`;
}

const START = "/**\n * This agent's beat:";
const END = "\n};";

let applied = 0;
for (const [agent, beat] of Object.entries(BEATS)) {
  const path = `agents/${agent}/index.ts`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.warn(`skip ${agent}: no index.ts`);
    continue;
  }
  let src = await file.text();
  const next = block(agent, beat);

  const at = src.indexOf(START);
  if (at !== -1) {
    // Replace the existing block.
    const endAt = src.indexOf(END, at);
    if (endAt === -1) throw new Error(`${agent}: BEAT block start without end`);
    src = src.slice(0, at) + next + src.slice(endAt + END.length);
  } else {
    // Insert after the SPECIALTY declaration.
    const m = src.match(/const SPECIALTY =\n?[\s\S]*?;\n/);
    if (!m) throw new Error(`${agent}: no SPECIALTY anchor`);
    const insertAt = m.index! + m[0].length;
    src = src.slice(0, insertAt) + "\n" + next + "\n" + src.slice(insertAt);
  }

  await Bun.write(path, src);
  const on = [
    beat.googleNews && "news",
    beat.gdelt && "gdelt",
    beat.edgar && "edgar",
  ].filter(Boolean);
  console.log(
    `✓ ${agent.padEnd(15)} ${on.join("+").padEnd(18)} ${beat.domains.length} domains, ${beat.angles.length} angles`,
  );
  applied++;
}

console.log(`\n${applied} beats applied.`);
