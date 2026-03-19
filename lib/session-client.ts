import type { Session } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";

export async function waitForSession(maxWaitMs = 2500, _pollMs = 200): Promise<Session | null> {
  void _pollMs;

  try {
    const { data, error } = await supabaseBrowser.auth.getSession();
    if (error) throw error;
    if (data.session) return data.session;
  } catch {
    // Fall through to auth event subscription.
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const authListener = supabaseBrowser.auth.onAuthStateChange((event, session) => {
      if (session) {
        finish(session);
        return;
      }

      if (event === "SIGNED_OUT") {
        finish(null);
      }
    });

    const finish = (session: Session | null) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      authListener.data.subscription.unsubscribe();
      resolve(session);
    };

    timeoutId = setTimeout(() => finish(null), maxWaitMs);
  });
}
