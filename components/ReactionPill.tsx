"use client";

import { useRef, useState } from "react";

type Props = {
  emoji: string;
  count: number;
  names: string[];
};

export function ReactionPill({ emoji, count, names }: Props) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);

  function onEnter() {
    timer.current = window.setTimeout(() => {
      setOpen(true);
    }, 120);
  }

  function onLeave() {
    if (timer.current) window.clearTimeout(timer.current);
    setOpen(false);
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-sm hover:bg-neutral-50"
      >
        <span>{emoji}</span>
        <span className="tabular-nums">{count}</span>
      </button>

      {open && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={onLeave}
          className="absolute left-1/2 top-full z-50 mt-2 w-max max-w-[260px] -translate-x-1/2 rounded-lg border bg-white px-3 py-2 text-sm shadow-lg"
        >
          <div className="mb-1 font-medium">{emoji}</div>

          <div className="text-neutral-800">
            {names.length === 0
              ? "No reactions yet"
              : names.length <= 12
              ? names.join(", ")
              : `${names.slice(0, 12).join(", ")} +${names.length - 12} more`}
          </div>
        </div>
      )}
    </span>
  );
}
