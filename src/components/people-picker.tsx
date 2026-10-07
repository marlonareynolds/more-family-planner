"use client";

import { useApp } from "./app-context";
import { cx } from "./ui";

/** Toggle chips for adults and children. Uses stable ids, never names. */
export function PeoplePicker({
  adultIds,
  childIds,
  onChange,
  showAdults = true,
  showChildren = true,
  label = "Who",
}: {
  adultIds: string[];
  childIds: string[];
  onChange: (v: { adultIds: string[]; childIds: string[] }) => void;
  showAdults?: boolean;
  showChildren?: boolean;
  label?: string;
}) {
  const app = useApp();
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-ink-2">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {showAdults &&
          app.adults.map((a) => (
            <Chip key={a.id} on={adultIds.includes(a.id)} onClick={() => onChange({ adultIds: toggle(adultIds, a.id), childIds })}>
              {a.id === app.me.id ? "Me" : a.displayName}
            </Chip>
          ))}
        {showChildren &&
          app.children.map((c) => (
            <Chip key={c.id} on={childIds.includes(c.id)} onClick={() => onChange({ adultIds, childIds: toggle(childIds, c.id) })}>
              {c.preferredName}
            </Chip>
          ))}
        {showChildren && !app.children.length && <span className="text-sm text-ink-3">Add children in Settings.</span>}
      </div>
    </fieldset>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className={cx("min-h-9 rounded-full border px-3 text-sm", on ? "border-brand bg-brand-soft text-brand" : "border-line text-ink-2")}
    >
      {on ? "✓ " : ""}
      {children}
    </button>
  );
}
