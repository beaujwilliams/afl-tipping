import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSession(maxWaitMs = 2500, pollMs = 200): Promise<Session | null> {
  const started = Date.now();

  while (Date.now() - started <= maxWaitMs) {
    try {
      const { data, error } = await supabaseBrowser.auth.getSession();
      if (error) throw error;
      if (data.session) return data.session;
    } catch {
      // Transient auth/network issue; retry until timeout.
    }

    await delay(pollMs);
  }

  return null;
}
