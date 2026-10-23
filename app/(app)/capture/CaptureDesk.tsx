"use client";

import { useState } from "react";
import { Landmark, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui";
import { ConnectCard } from "./ConnectCard";
import { DistrictDesk } from "./DistrictDesk";
import { HighCourtDesk } from "./HighCourtDesk";

type Court = "district" | "highcourt";

/** Both courts' runs, and the extension that does the reading. */
export function CaptureDesk({ court: initialCourt, run }: { court: Court; run: string | null }) {
  const [court, setCourt] = useState<Court>(initialCourt);
  const tabs: { key: Court; label: string; sub: string; icon: typeof Landmark }[] = [
    { key: "district", label: "District court", sub: "Saket · newest cases per case type", icon: Landmark },
    { key: "highcourt", label: "High Court of Delhi", sub: "Judgments per sitting judge", icon: ScrollText },
  ];
  return (
    <>
      <PageHeader
        eyebrow="Capture"
        title="Runs & extension"
        subtitle="The Court Capture extension drives each court's own search page: it fills every search and saves everything it reads here. The only thing a person does is type the court's captcha."
      />
      <div className="mb-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = court === t.key;
            return (
              <button
                key={t.key}
                onClick={() => {
                  setCourt(t.key);
                  window.history.replaceState(null, "", `?court=${t.key}`);
                }}
                className={cn("cc-card flex items-center gap-3 p-4 text-left transition-colors", on ? "border-accent/45 bg-accent/[0.06]" : "hover:border-hairlineStrong")}
              >
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-[9px] border", on ? "border-accent/40 text-accent" : "border-hairline text-faint")}>
                  <Icon className="h-4 w-4" />
                </span>
                <span>
                  <span className="block text-[13.5px] font-semibold text-foreground">{t.label}</span>
                  <span className="block text-[12px] text-faint">{t.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <ConnectCard />
      </div>
      {court === "district" ? <DistrictDesk key="d" initialRun={initialCourt === "district" ? run : null} /> : <HighCourtDesk key="h" initialRun={initialCourt === "highcourt" ? run : null} />}
    </>
  );
}
