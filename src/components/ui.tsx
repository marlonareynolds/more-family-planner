"use client";

import { X } from "lucide-react";
import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }>(
  function Button({ variant = "secondary", size = "md", className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cx(
          "inline-flex select-none items-center justify-center gap-1.5 rounded-full font-medium transition-[background-color,transform,box-shadow] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
          size === "sm" ? "min-h-9 px-3 text-sm" : "min-h-11 px-4 text-[15px]",
          variant === "primary" && "bg-brand text-brand-ink shadow-soft hover:brightness-110",
          variant === "secondary" && "border border-line bg-surface text-ink hover:bg-surface-2",
          variant === "ghost" && "text-ink-2 hover:bg-surface-2",
          variant === "danger" && "border border-bad/40 bg-surface text-bad hover:bg-bad/10",
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink-2">
        {label}
      </label>
      {children(id, hintId)}
      {hint && (
        <p id={hintId} className="text-xs text-ink-3">
          {hint}
        </p>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </div>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none";

export function Card({ children, className, tone, style }: { children: ReactNode; className?: string; tone?: "me" | "us" | "family" | "care" | "neutral"; style?: React.CSSProperties }) {
  return (
    <div
      style={style}
      className={cx(
        "rounded-2xl border border-line/70 bg-surface p-4 shadow-soft",
        tone === "me" && "border-l-4 border-l-me",
        tone === "us" && "border-l-4 border-l-us",
        tone === "family" && "border-l-4 border-l-family",
        tone === "care" && "border-l-4 border-l-care",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "me" | "us" | "family" | "care" }) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-2 text-ink-2",
        tone === "good" && "bg-good/12 text-good",
        tone === "warn" && "bg-warn/12 text-warn",
        tone === "bad" && "bg-bad/10 text-bad",
        tone === "me" && "bg-me-soft text-me",
        tone === "us" && "bg-us-soft text-us",
        tone === "family" && "bg-family-soft text-family",
        tone === "care" && "bg-care-soft text-care",
      )}
    >
      {children}
    </span>
  );
}

/** Accessible modal built on the native dialog element (focus trap, Escape). */
export function Dialog({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none rounded-t-3xl border border-line bg-surface p-0 text-ink sm:m-auto sm:max-w-lg sm:rounded-3xl"
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 id={titleId} className="font-display text-xl">
              {title}
            </h2>
            <button onClick={onClose} className="rounded-full p-2 text-ink-2 hover:bg-surface-2" aria-label="Close">
              <X aria-hidden size={20} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

const EMPTY_TONE = {
  brand: "bg-brand-soft text-brand",
  me: "bg-me-soft text-me",
  us: "bg-us-soft text-us",
  family: "bg-family-soft text-family",
} as const;

/**
 * A friendly empty state: a small illustration built from an icon, a title,
 * one line of why, and one clear next step. Pass the icon as an element
 * (`icon={<MapPin />}`) so server pages can use it too.
 */
export function EmptyState({ title, children, icon, tone = "brand", action }: { title: string; children?: ReactNode; icon?: ReactNode; tone?: keyof typeof EMPTY_TONE; action?: ReactNode }) {
  return (
    <div className="rise flex flex-col items-center rounded-3xl border border-dashed border-line bg-surface/60 px-6 py-9 text-center">
      {icon && (
        <div className="relative mb-4" aria-hidden>
          <span className={cx("absolute -left-3 top-1 size-2.5 rounded-full opacity-60", EMPTY_TONE[tone])} />
          <span className={cx("absolute -right-2 -top-1 size-4 rounded-full opacity-50", EMPTY_TONE[tone])} />
          <span className={cx("absolute -bottom-1 right-[-14px] size-2 rounded-full opacity-70", EMPTY_TONE[tone])} />
          <div className={cx("pop grid size-16 rotate-[-6deg] place-items-center rounded-[1.4rem] shadow-soft [&_svg]:size-8 [&_svg]:rotate-[6deg]", EMPTY_TONE[tone])}>{icon}</div>
        </div>
      )}
      <p className="font-display text-xl text-ink">{title}</p>
      {children && <div className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-ink-2">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** A selectable card for one-of-many choices, with a real radio inside. */
export function ChoiceCard({ name, checked, onChange, children }: { name: string; checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label
      className={cx(
        "group relative flex cursor-pointer gap-3 rounded-2xl border bg-surface p-3.5 transition-[border-color,background-color,box-shadow,transform] duration-150 active:scale-[0.99]",
        checked ? "border-brand bg-brand-soft/60 shadow-soft" : "border-line hover:border-ink-3/40",
      )}
    >
      <input type="radio" name={name} className="peer sr-only" checked={checked} onChange={onChange} />
      <span
        aria-hidden
        className={cx(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)]",
          checked ? "border-brand bg-brand" : "border-line bg-surface",
        )}
      >
        {checked && <span className="pop size-2 rounded-full bg-brand-ink" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </label>
  );
}

export function SectionTitle({ children, action, hint }: { children: ReactNode; action?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 mt-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-xl text-ink">{children}</h2>
        {action}
      </div>
      {hint && <p className="mt-1 text-sm text-ink-3">{hint}</p>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-surface p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("min-h-9 rounded-full px-3 text-sm transition-colors duration-150", value === o.value ? "bg-brand text-brand-ink shadow-soft" : "text-ink-2 hover:bg-surface-2")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-5 accent-[var(--brand)]" />
      <label htmlFor={id} className="text-[15px]">
        {label}
        {hint && <span className="block text-xs text-ink-3">{hint}</span>}
      </label>
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
      {message}
    </p>
  );
}
