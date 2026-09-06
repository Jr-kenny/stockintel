/**
 * Propagate the beat-aware research body from web-research to the other agents.
 *
 * The nine news agents share one implementation. web-research is the canonical
 * copy: edit it, run this, and the shared body moves everywhere while each
 * agent keeps its own identity (PORT, NAME, SPECIALTY) and its own BEAT.
 *
 * media-youtube is excluded — it is genuinely different code, not a clone.
 *
 * Run: bun scripts/sync-agent-body.ts
 */

const CANONICAL = "agents/web-research/index.ts";

/** Agents that share the canonical body. media-youtube deliberately absent. */
const TARGETS = [
  "company-intel",
  "person-role",
  "prime-signals",
  "procurement",
  "project-intel",
  "social-signal",
  "synthesis",
  "verification",
];

/**
 * Regions each agent owns. Everything else comes from the canonical file.
 * Anchored on the exact declarations so a body edit can never clobber identity.
 */
const OWNED: { name: string; re: RegExp }[] = [
  { name: "PORT", re: /^const PORT = .*$/m },
  { name: "NAME", re: /^const NAME = .*$/m },
  { name: "SPECIALTY", re: /^const SPECIALTY =\n?[\s\S]*?;$/m },
  { name: "BEAT", re: /^\/\*\*\n \* This agent's beat:[\s\S]*?^};$/m },
];

const canonical = await Bun.file(CANONICAL).text();

let synced = 0;
for (const agent of TARGETS) {
  const path = `agents/${agent}/index.ts`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.warn(`skip ${agent}: no index.ts`);
    continue;
  }
  const existing = await file.text();

  // Lift this agent's owned regions out of its current file.
  const mine: Record<string, string> = {};
  for (const { name, re } of OWNED) {
    const m = existing.match(re);
    if (!m) {
      console.warn(`  ${agent}: no ${name} region found, will inherit canonical`);
      continue;
    }
    mine[name] = m[0];
  }

  // Start from the canonical body, then stamp the agent's own regions back in.
  let next = canonical;
  for (const { name, re } of OWNED) {
    const replacement = mine[name];
    if (!replacement) continue;
    if (!re.test(next)) {
      throw new Error(`canonical is missing its ${name} region — cannot sync safely`);
    }
    next = next.replace(re, () => replacement);
  }

  if (next === existing) {
    console.log(`= ${agent} already current`);
    continue;
  }
  await Bun.write(path, next);
  console.log(`✓ ${agent} synced`);
  synced++;
}

console.log(`\n${synced} agent(s) synced from ${CANONICAL}.`);
