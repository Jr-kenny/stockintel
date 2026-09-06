import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { AgentOsPrompt } from "@/components/app/agent-os-prompt";

export const Route = createFileRoute("/app")({
  head: () => ({
    meta: [
      { title: "StockIntel workspace" },
      {
        name: "description",
        content:
          "The StockIntel market-intelligence workspace: assessments, evidence, the Exposure Graph and your watchlist.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <AppShell>
      <AgentOsPrompt />
      <Outlet />
    </AppShell>
  ),
});
