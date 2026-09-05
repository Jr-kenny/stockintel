import { createFileRoute } from "@tanstack/react-router";
import { CityLanding } from "@/components/city/CityLanding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StockIntel · Find the event before it becomes the price" },
      {
        name: "description",
        content:
          "Event-driven equity intelligence. Name a ticker, StockIntel investigates the world behind it, then checks if the thesis is priced in yet.",
      },
    ],
  }),
  component: CityLanding,
});
