"use client";

import { ExternalLink } from "lucide-react";
import { bookingLinks } from "@/domain/booking";
import { CATALOGUE, type Category, type Setting } from "@/lib/catalogue";
import { placeKey } from "@/lib/places";
import { useApp } from "./app-context";
import { localParts } from "./format";

/** One tap to book what a plan is: your own place's page, or a search near home. */
export function BookingLinks({ activityKey, category, setting, start, people }: { activityKey?: string | null; category?: Category; setting?: Setting; start?: number; people?: number }) {
  const app = useApp();
  const place = activityKey?.startsWith("place:") ? app.places.find((p) => placeKey(p.id) === activityKey) : null;
  const idea = !place && activityKey ? CATALOGUE.find((a) => a.key === activityKey) : null;
  const cat = place?.category ?? idea?.category ?? category;
  const set = place?.setting ?? idea?.setting ?? setting;
  if (!cat || !set) return null;
  const when = start ? localParts(start, app.timeZone) : null;
  const links = bookingLinks({ category: cat, setting: set, bookingUrl: place?.bookingUrl, near: app.placeName, localStart: when ? `${when.date}T${when.time}` : undefined, people });
  if (!links.length) return null;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((l) => (
        <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand underline">
          {l.label} <ExternalLink aria-hidden size={13} />
        </a>
      ))}
    </p>
  );
}
