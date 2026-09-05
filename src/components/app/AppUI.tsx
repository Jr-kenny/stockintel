import { ArrowUpRight, Check, CircleAlert, Dot, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type StatusTone = "verified" | "tracking" | "flagged";

const toneStyles: Record<StatusTone, string> = {
  verified: "app-status app-status-verified",
  tracking: "app-status app-status-tracking",
  flagged: "app-status app-status-flagged",
};

const toneLabels: Record<StatusTone, string> = {
  verified: "Verified",
  tracking: "Tracking",
  flagged: "Contradicted",
};

export function StatusPill({
  tone,
  label,
  compact = false,
}: {
  tone: StatusTone;
  label?: string;
  compact?: boolean;
}) {
  return (
    <span className={`${toneStyles[tone]} ${compact ? "app-status-compact" : ""}`}>
      <span className="app-status-dot" aria-hidden />
      {label ?? toneLabels[tone]}
    </span>
  );
}

export function ConfidenceValue({
  value,
  delta,
  tone = "verified",
  compact = false,
}: {
  value: number;
  delta?: number;
  tone?: StatusTone;
  compact?: boolean;
}) {
  return (
    <div className={`app-confidence ${compact ? "app-confidence-compact" : ""}`}>
      <span className={`app-confidence-value app-tone-${tone}`}>{value}%</span>
      {typeof delta === "number" && (
        <span
          className={`app-confidence-delta ${delta >= 0 ? "app-tone-verified" : "app-tone-flagged"}`}
        >
          {delta >= 0 ? "↑" : "↓"} {Math.abs(delta)} pts
        </span>
      )}
    </div>
  );
}

export function MetricBlock({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "signal" | "verified" | "flagged" | "neutral";
}) {
  return (
    <div className="app-metric-block">
      <p className="label-mono app-muted-label">{label}</p>
      <p className={`app-metric-value app-tone-${tone}`}>{value}</p>
      {note && <p className="app-metric-note">{note}</p>}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
  dark = false,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  dark?: boolean;
}) {
  return (
    <div className={`app-section-heading ${dark ? "app-section-heading-dark" : ""}`}>
      <div>
        {eyebrow && <p className="label-mono app-muted-label">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function ArrowLink({
  children,
  href,
  icon: Icon = ArrowUpRight,
}: {
  children: ReactNode;
  href: string;
  icon?: LucideIcon;
}) {
  return (
    <a href={href} className="app-arrow-link">
      {children}
      <Icon className="size-3.5" aria-hidden />
    </a>
  );
}

export function EvidenceMarker({
  id,
  status = "verified",
  children,
}: {
  id: string;
  status?: StatusTone;
  children: ReactNode;
}) {
  return (
    <div className="app-evidence-marker">
      <div className="app-evidence-marker-top">
        <span className="label-mono app-tone-signal">{id}</span>
        <StatusPill tone={status} compact />
      </div>
      <p>{children}</p>
    </div>
  );
}

export function AgentBadge({ name, type }: { name: string; type?: string }) {
  return (
    <span className="app-agent-badge">
      <span className="app-agent-badge-mark" aria-hidden>
        <Dot className="size-3" />
      </span>
      <span>{name}</span>
      {type && <span className="app-agent-type">{type}</span>}
    </span>
  );
}

export function SignalRule({
  icon: Icon = Check,
  children,
  tone = "verified",
}: {
  icon?: LucideIcon;
  children: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <li className="app-signal-rule">
      <span className={`app-signal-rule-icon app-tone-${tone}`}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span>{children}</span>
    </li>
  );
}

export function ContradictionNote({ children }: { children: ReactNode }) {
  return (
    <div className="app-contradiction">
      <CircleAlert className="size-4 shrink-0 text-flag" aria-hidden />
      <div>
        <p className="label-mono text-flag">Contradiction preserved</p>
        <p className="mt-1 text-sm leading-relaxed">{children}</p>
      </div>
    </div>
  );
}
