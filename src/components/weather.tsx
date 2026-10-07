"use client";

import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSun, Snowflake, Sun, Umbrella } from "lucide-react";
import { useState } from "react";
import type { DayWeather, WeatherIcon } from "@/domain/weather";
import type { MomentView, WetPlan } from "@/server/queries/week";
import { useApp } from "./app-context";
import { toast } from "./toast";
import { Button, Card } from "./ui";
import { useCommand } from "./use-command";

const ICONS: Record<WeatherIcon, typeof Sun> = { sun: Sun, "cloud-sun": CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: Snowflake, storm: CloudLightning };

export function WeatherGlyph({ w, size = 16, className }: { w: DayWeather; size?: number; className?: string }) {
  const Icon = ICONS[w.icon];
  return <Icon aria-label={w.label} role="img" size={size} className={className} />;
}

/** "Bright spells, 9–15°, 20% chance of rain" for a day. */
export function weatherText(w: DayWeather): string {
  return `${w.label}, ${w.low}–${w.high}°${w.rain >= 30 ? `, ${w.rain}% chance of rain` : ""}`;
}

export function WeatherLine({ w }: { w: DayWeather | undefined }) {
  if (!w) return null;
  return (
    <p className="flex items-center gap-2 text-[15px] text-ink-2">
      <WeatherGlyph w={w} size={18} className="text-brand" />
      {weatherText(w)}
    </p>
  );
}

/**
 * Rain is likely for an outdoor plan: offer what to do instead. One tap
 * changes what the plan is and keeps its time, people and childcare.
 */
export function WetPlanCard({ plan, moment }: { plan: WetPlan; moment: MomentView }) {
  const app = useApp();
  const { run, pending, error } = useCommand(app.householdId);
  const [done, setDone] = useState(false);
  const own = moment.momentKind === "me";
  async function swap(s: WetPlan["swaps"][number]) {
    const r = await run("SwapActivity", { momentId: moment.id, version: moment.version, title: s.title, activityKey: s.activityKey, location: s.location ?? "" });
    if (r) {
      setDone(true);
      toast(own ? "Swapped. Enjoy staying dry." : `Swapped to ${s.title}. Everyone going has been told.`);
    }
  }
  if (done) return null;
  return (
    <Card tone={own ? "me" : "family"}>
      <p className="flex items-center gap-2 font-medium"><Umbrella aria-hidden size={17} className="text-brand" /> Rain is likely for {own ? "your time" : moment.title} ({plan.chance}%)</p>
      {plan.swaps.length ? (
        <>
          <p className="mt-1 text-sm text-ink-2">Same time, same people. Swap to:</p>
          <ul className="mt-2 flex flex-col gap-2">
            {plan.swaps.map((s) => (
              <li key={s.title} className="flex items-center justify-between gap-3">
                <span className="min-w-0"><span className="block font-medium">{s.title}</span><span className="block text-sm text-ink-3">{s.summary}</span></span>
                <Button size="sm" disabled={pending} onClick={() => swap(s)}>Swap</Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-2">Pack the waterproofs, or move it to a drier day.</p>
      )}
      {error && <p className="mt-2 text-sm text-bad">{error.message}</p>}
    </Card>
  );
}
