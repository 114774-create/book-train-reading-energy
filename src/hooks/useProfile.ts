import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/lib/types";

export function useProfile() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user?.id;
      if (!uid) {
        if (alive) {
          setProfile(null);
          setLoading(false);
        }
        return;
      }

      const { data, error } = await supabase.from("users").select("id,account,student_no,name,role,class_code").eq("id", uid).maybeSingle();
      if (!alive) return;
      if (error) {
        // eslint-disable-next-line no-console
        console.error(error);
        setProfile(null);
        setLoading(false);
        return;
      }
      setProfile((data as any) ?? null);
      setLoading(false);
    }

    load();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      load();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { loading, profile };
}
