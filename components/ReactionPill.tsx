"use client";

import { useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Props = {
  messageId: string;
  emoji: string;
  count: number;
};

const cache = new Map<string, { names: string[]; ts: number }>();
const TTL = 60_000;

export function ReactionPill({ messageId, emoji, count }: Props) {
  const supabase = supabaseBrowser;

  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const timer = useRef<number | null>(null);
  const key = `${messageId}:${emoji}`;

  async function loadNames() {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.ts < TTL) {
      setNames(cached.names);
      return;
    }

    setLoading(true);

    const { data, error } = await supabase
      .from("chat_reactions")
      .select("user_id, profiles:profiles(display_name)")
      .eq("message_id", messageId)
      .eq("emoji", emoji);

    setLoading(false);

    if (error) {
      setNames(["(couldn't load)"]);
      return;
    }

    const list =
      (data ?? [])
        .map((r: any) => r.profiles?.display_name)
        .filter(Boolean) as string[];

    cache.set(key, { names: list, ts: Date.now() });
    setNames(list);
  }

  function onEnter() {
    timer.current = window.setTimeout(async () => {
      setOpen(true);
      if (names === null) await loadNames();
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

          {loading && <div className="text-neutral-500">Loading...</div>}

          {!loading && names && (
            <div className="text-neutral-800">
              {names.length === 0
                ? "No reactions yet"
                : names.length <= 12
                ? names.join(", ")
                : `${names.slice(0, 12).join(", ")} +${names.length - 12} more`}
            </div>
          )}
        </div>
      )}
    </span>
  );
}