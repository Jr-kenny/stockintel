/**
 * One coherent demo story shared across the whole product application.
 * Three recurring entities: ABC Manufacturing, Marlowe Bay Hotels, Meridian Fintech.
 */

export type Status = "verified" | "flagged" | "open";

export const statusText: Record<Status, string> = {
  verified: "text-verified",
  flagged: "text-flag",
  open: "text-signal",
};

export const statusLabel: Record<Status, string> = {
  verified: "VERIFIED",
  flagged: "CONTRADICTED",
  open: "TRACKING",
};

export type EvidenceItem = {
  id: string;
  company: string;
  claim: string;
  source: string;
  sourceType: string;
  agent: string;
  observed: string;
  status: Status;
  note?: string;
};

export type Opportunity = {
  id: string;
  company: string;
  location: string;
  industry: string;
  need: string;
  confidence: number;
  delta: number;
  window: string;
  size: string;
  status: Status;
  state: "new" | "watching" | "converted" | "expired";
  summary: string;
  reasons: string[];
  agents: string[];
  evidenceIds: string[];
  contradiction?: string;
  timeline: { period: string; event: string }[];
  otherNeeds: { need: string; confidence: number }[];
  events: string[];
};

export const EVIDENCE: EvidenceItem[] = [
  {
    id: "EV-94821",
    company: "ABC Manufacturing",
    claim: "Factory permit filed · 80,000 sqm",
    source: "Nigeria planning record",
    sourceType: "Public registry",
    agent: "Nigeria Construction Agent",
    observed: "17 Aug 2026",
    status: "verified",
    note: "Permit NP-22841, industrial classification",
  },
  {
    id: "EV-94822",
    company: "ABC Manufacturing",
    claim: "213 manufacturing roles opened",
    source: "Aggregated job boards",
    sourceType: "Hiring data",
    agent: "Prime Jobs Agent",
    observed: "12 Aug 2026",
    status: "verified",
    note: "Line operators, maintenance, plant electrical",
  },
  {
    id: "EV-94823",
    company: "ABC Manufacturing",
    claim: "Opening date reported as Q1 2027",
    source: "Regional business press",
    sourceType: "Press",
    agent: "Corporate Expansion Agent",
    observed: "15 Aug 2026",
    status: "flagged",
    note: "CONTRADICTS EV-94801 (Q4 2026 completion)",
  },
  {
    id: "EV-94801",
    company: "ABC Manufacturing",
    claim: "Facility completion expected Q4 2026",
    source: "Financing disclosure",
    sourceType: "Filing",
    agent: "Prime Corporate Crawler",
    observed: "02 Aug 2026",
    status: "verified",
    note: "Energy modernization line item included",
  },
  {
    id: "EV-94810",
    company: "ABC Manufacturing",
    claim: "Grid reliability problems referenced publicly",
    source: "Executive interview",
    sourceType: "Press",
    agent: "Energy Infrastructure Agent",
    observed: "29 Jul 2026",
    status: "verified",
  },
  {
    id: "EV-94744",
    company: "Marlowe Bay Hotels",
    claim: "150-room property permit filed",
    source: "Lagos planning portal",
    sourceType: "Public registry",
    agent: "Nigeria Construction Agent",
    observed: "28 Jul 2026",
    status: "verified",
    note: "Permit LP-88214",
  },
  {
    id: "EV-94745",
    company: "Marlowe Bay Hotels",
    claim: "Fit-out tender preparation underway",
    source: "Contractor announcement",
    sourceType: "Company announcement",
    agent: "Hospitality Expansion Agent",
    observed: "04 Aug 2026",
    status: "verified",
  },
  {
    id: "EV-94746",
    company: "Marlowe Bay Hotels",
    claim: "Capex line for guest-room AV",
    source: "Company filing",
    sourceType: "Filing",
    agent: "Prime Corporate Crawler",
    observed: "09 Aug 2026",
    status: "verified",
  },
  {
    id: "EV-94612",
    company: "Meridian Fintech",
    claim: "CISO appointed",
    source: "Company announcement",
    sourceType: "Company announcement",
    agent: "Prime Corporate Crawler",
    observed: "21 Jul 2026",
    status: "verified",
  },
  {
    id: "EV-94613",
    company: "Meridian Fintech",
    claim: "Fraud incident disclosed to regulator",
    source: "Regulatory notice",
    sourceType: "Regulator",
    agent: "Financial Regulation Agent",
    observed: "06 Aug 2026",
    status: "verified",
  },
  {
    id: "EV-94614",
    company: "Meridian Fintech",
    claim: "Security engineering hiring accelerating",
    source: "Aggregated job boards",
    sourceType: "Hiring data",
    agent: "Prime Jobs Agent",
    observed: "11 Aug 2026",
    status: "open",
    note: "9 roles, identity and risk platform",
  },
];

export const evidenceById = (id: string) => EVIDENCE.find((e) => e.id === id);

export const OPPORTUNITIES: Opportunity[] = [
  {
    id: "abc-solar",
    company: "ABC Manufacturing",
    location: "Ogun State, NG",
    industry: "Manufacturing",
    need: "Commercial solar / industrial power",
    confidence: 92,
    delta: 11,
    window: "30–90 days",
    size: "₦100m–₦300m",
    status: "verified",
    state: "new",
    summary:
      "A new 80,000 sqm plant is approaching completion while the company is publicly describing grid reliability problems and has financing earmarked for energy modernization.",
    reasons: [
      "New 80,000 sqm factory approved",
      "213 manufacturing positions opened",
      "Energy modernization included in financing",
      "Grid reliability issues mentioned publicly",
      "Facility completion expected Q4",
    ],
    agents: [
      "Nigeria Construction Agent",
      "Energy Infrastructure Agent",
      "Prime Corporate Crawler",
    ],
    evidenceIds: ["EV-94821", "EV-94822", "EV-94801", "EV-94810", "EV-94823"],
    contradiction:
      "One source reports the facility opening moved to Q1 2027. This reduces timing confidence but does not invalidate the expansion.",
    timeline: [
      { period: "MAY", event: "Financing closed" },
      { period: "JUNE", event: "Land acquisition detected" },
      { period: "JULY", event: "Construction permit filed" },
      { period: "AUGUST", event: "Hiring accelerated" },
      { period: "TODAY", event: "Demand confidence: 92%" },
    ],
    otherNeeds: [
      { need: "ERP / plant systems", confidence: 73 },
      { need: "Logistics capacity", confidence: 81 },
    ],
    events: [
      "Opened new factory",
      "Raised financing",
      "Manufacturing hiring ↑",
      "Energy reliability issues",
    ],
  },
  {
    id: "marlowe-displays",
    company: "Marlowe Bay Hotels",
    location: "Lagos, NG",
    industry: "Hospitality",
    need: "Commercial displays",
    confidence: 87,
    delta: 11,
    window: "45–90 days",
    size: "150–200 units",
    status: "verified",
    state: "watching",
    summary:
      "A 150-room property is entering fit-out, with procurement activity beginning and an AV capex line already disclosed.",
    reasons: [
      "150-room property permit filed",
      "Fit-out contractor appointed",
      "Guest-room AV capex disclosed",
      "Opening targeted before year end",
    ],
    agents: [
      "Nigeria Construction Agent",
      "Hospitality Expansion Agent",
      "Prime Corporate Crawler",
    ],
    evidenceIds: ["EV-94744", "EV-94745", "EV-94746"],
    timeline: [
      { period: "JUNE", event: "Site secured" },
      { period: "JULY", event: "Permit filed, 150 keys" },
      { period: "AUGUST", event: "Fit-out contractor appointed" },
      { period: "TODAY", event: "Demand confidence: 87%" },
    ],
    otherNeeds: [
      { need: "HVAC", confidence: 79 },
      { need: "Networking", confidence: 68 },
    ],
    events: ["New 150-room property", "Fit-out approaching", "Procurement beginning"],
  },
  {
    id: "meridian-fraud",
    company: "Meridian Fintech",
    location: "Nairobi, KE",
    industry: "Financial services",
    need: "Fraud prevention / identity security",
    confidence: 78,
    delta: 9,
    window: "60–120 days",
    size: "$180k–$450k annual",
    status: "open",
    state: "new",
    summary:
      "A disclosed fraud incident, a newly appointed CISO and accelerating security hiring together suggest security spend is being restructured.",
    reasons: [
      "CISO appointed",
      "Fraud incident disclosed to regulator",
      "Security engineering hiring accelerating",
      "Expansion into an additional regulated market",
    ],
    agents: ["Financial Regulation Agent", "Prime Jobs Agent", "Prime Corporate Crawler"],
    evidenceIds: ["EV-94612", "EV-94613", "EV-94614"],
    timeline: [
      { period: "JULY", event: "CISO appointed" },
      { period: "AUGUST", event: "Fraud incident disclosed" },
      { period: "AUGUST", event: "Security hiring accelerated" },
      { period: "TODAY", event: "Demand confidence: 78%" },
    ],
    otherNeeds: [{ need: "Compliance tooling", confidence: 61 }],
    events: ["New CISO", "Security hiring", "Regulated-market expansion", "Fraud incident"],
  },
  {
    id: "xyz-automation",
    company: "XYZ Logistics",
    location: "Tema, GH",
    industry: "Logistics",
    need: "Warehouse automation",
    confidence: 81,
    delta: 4,
    window: "3–6 months",
    size: "New 80,000 sqm facility",
    status: "verified",
    state: "watching",
    summary:
      "A new distribution facility is being built out with throughput commitments that current manual handling cannot meet.",
    reasons: [
      "New 80,000 sqm facility under construction",
      "Third-party throughput contract signed",
      "Warehouse supervisor hiring flat while volume rises",
    ],
    agents: ["Corporate Expansion Agent", "Prime Jobs Agent"],
    evidenceIds: ["EV-94821", "EV-94822"],
    timeline: [
      { period: "JUNE", event: "Facility groundwork" },
      { period: "AUGUST", event: "Throughput contract signed" },
      { period: "TODAY", event: "Demand confidence: 81%" },
    ],
    otherNeeds: [{ need: "Fleet telematics", confidence: 57 }],
    events: ["New warehouse", "Throughput contract", "Volume rising"],
  },
  {
    id: "corvine-furnishing",
    company: "Corvine Serviced Living",
    location: "Accra, GH",
    industry: "Real estate",
    need: "Displays and small appliances",
    confidence: 47,
    delta: -6,
    window: "unresolved",
    size: "52–88 units",
    status: "flagged",
    state: "new",
    summary:
      "Sources disagree on unit count and scope; procurement notice covers soft furnishings only.",
    reasons: [
      "88 serviced apartments listed by developer",
      "Local press reports 52 units",
      "Procurement notice excludes AV",
    ],
    agents: ["Hospitality Expansion Agent", "Corporate Expansion Agent"],
    evidenceIds: ["EV-94744"],
    contradiction:
      "Developer materials and local press disagree on unit count. Until resolved, volume estimates are unreliable.",
    timeline: [
      { period: "JUNE", event: "Developer listing published" },
      { period: "JULY", event: "Conflicting press report" },
      { period: "TODAY", event: "Demand confidence: 47%" },
    ],
    otherNeeds: [],
    events: ["Furnishing 88 units", "Unit count disputed"],
  },
];

export const opportunityById = (id: string) => OPPORTUNITIES.find((o) => o.id === id);

export type SupplyRecord = {
  id: string;
  name: string;
  detail: { label: string; value: string }[];
  markets: string[];
  targets: string[];
  matches: number;
  highConfidence: number;
};

export const SUPPLY: SupplyRecord[] = [
  {
    id: "tcl-55",
    name: "TCL 55-inch Smart TV",
    detail: [
      { label: "Available", value: "5,000" },
      { label: "Minimum order", value: "20" },
    ],
    markets: ["Nigeria"],
    targets: ["Hospitality", "Retail", "Entertainment"],
    matches: 23,
    highConfidence: 7,
  },
  {
    id: "solar-install",
    name: "Commercial solar installation",
    detail: [
      { label: "Typical contract", value: "₦30m–₦500m" },
      { label: "Capacity", value: "5 installs / month" },
    ],
    markets: ["Nigeria", "Ghana"],
    targets: ["Manufacturing", "Cold chain", "Healthcare"],
    matches: 14,
    highConfidence: 5,
  },
  {
    id: "fraud-platform",
    name: "Fraud prevention platform",
    detail: [
      { label: "Contract band", value: "$120k–$600k / yr" },
      { label: "Deployment", value: "Cloud or in-region" },
    ],
    markets: ["Kenya", "Nigeria", "South Africa"],
    targets: ["Fintech", "Banking", "Payments"],
    matches: 9,
    highConfidence: 3,
  },
];

export const AGENTS = [
  {
    name: "Nigeria Construction Agent",
    type: "Independent",
    specialty: "Construction permits & site filings",
    evidence: 41,
    unique: 62,
    reliability: 0.91,
  },
  {
    name: "Energy Infrastructure Agent",
    type: "Independent",
    specialty: "Grid events & power procurement",
    evidence: 18,
    unique: 48,
    reliability: 0.84,
  },
  {
    name: "Prime Corporate Crawler",
    type: "Prime",
    specialty: "Company announcements & filings",
    evidence: 96,
    unique: 31,
    reliability: 0.88,
  },
  {
    name: "Prime Jobs Agent",
    type: "Prime",
    specialty: "Hiring signals across job boards",
    evidence: 77,
    unique: 44,
    reliability: 0.9,
  },
  {
    name: "Financial Regulation Agent",
    type: "Independent",
    specialty: "Licensing & regulatory movement",
    evidence: 12,
    unique: 71,
    reliability: 0.95,
  },
  {
    name: "Hospitality Expansion Agent",
    type: "Independent",
    specialty: "Hotel openings & fit-out pipelines",
    evidence: 26,
    unique: 55,
    reliability: 0.87,
  },
];

export type ContributionTier = "discovery" | "confirmation" | "duplication";

export type Contribution = {
  id: string;
  agent: string;
  claim: string;
  tier: ContributionTier;
  dims: {
    relevance: number;
    quality: number;
    independence: number;
    reliability: number;
    impact: number;
  };
  inquiry: string;
};

export const CONTRIBUTIONS: Contribution[] = [
  {
    id: "CTB-3311",
    agent: "Nigeria Construction Agent",
    claim: "ABC Manufacturing filed a construction permit for a second production hall.",
    tier: "discovery",
    dims: { relevance: 0.94, quality: 0.88, independence: 0.97, reliability: 0.91, impact: 0.83 },
    inquiry: "INQ-208 · Industrial energy demand, Ogun State",
  },
  {
    id: "CTB-3308",
    agent: "Prime Jobs Agent",
    claim: "213 new manufacturing roles posted across two job boards in 11 days.",
    tier: "discovery",
    dims: { relevance: 0.81, quality: 0.74, independence: 0.92, reliability: 0.9, impact: 0.68 },
    inquiry: "INQ-208 · Industrial energy demand, Ogun State",
  },
  {
    id: "CTB-3302",
    agent: "Hospitality Expansion Agent",
    claim: "Marlowe Bay Hotels confirmed fit-out contractor for a 150-room property.",
    tier: "discovery",
    dims: { relevance: 0.97, quality: 0.91, independence: 0.89, reliability: 0.87, impact: 0.94 },
    inquiry: "INQ-204 · Hospitality AV & HVAC, Lagos",
  },
  {
    id: "CTB-3297",
    agent: "Energy Infrastructure Agent",
    claim: "Ogun State grid reliability advisory issued for industrial feeders.",
    tier: "confirmation",
    dims: { relevance: 0.86, quality: 0.69, independence: 0.41, reliability: 0.84, impact: 0.52 },
    inquiry: "INQ-208 · Industrial energy demand, Ogun State",
  },
  {
    id: "CTB-3295",
    agent: "Financial Regulation Agent",
    claim: "Meridian Fintech obtained a payment-service licence in a new market.",
    tier: "discovery",
    dims: { relevance: 0.92, quality: 0.95, independence: 1.0, reliability: 0.95, impact: 0.79 },
    inquiry: "INQ-201 · Fraud infrastructure, East Africa",
  },
  {
    id: "CTB-3290",
    agent: "Prime Corporate Crawler",
    claim: "Local press item repeating the Marlowe Bay expansion announcement.",
    tier: "duplication",
    dims: { relevance: 0.93, quality: 0.58, independence: 0.08, reliability: 0.88, impact: 0.11 },
    inquiry: "INQ-204 · Hospitality AV & HVAC, Lagos",
  },
];
