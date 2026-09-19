import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Max attempts allowed per IP within the given window, per action.
const LIMITS: Record<string, { max: number; windowMinutes: number }> = {
  lookup: { max: 20, windowMinutes: 15 },
  submit: { max: 5, windowMinutes: 60 },
};

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const action = body.action;

    if (!LIMITS[action]) return json({ error: "Invalid action" }, 400);

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
      req.headers.get("cf-connecting-ip") ||
      "unknown";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { max, windowMinutes } = LIMITS[action];
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const { count } = await admin
      .from("rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .eq("action", action)
      .gte("created_at", windowStart);

    if ((count ?? 0) >= max) {
      return json({ error: "Too many attempts. Please wait a while and try again." }, 429);
    }

    await admin.from("rate_limit_events").insert({ ip, action });

    // Best-effort cleanup of old events so the table doesn't grow forever.
    admin
      .from("rate_limit_events")
      .delete()
      .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .then(() => {})
      .catch(() => {});

    if (action === "lookup") {
      const student_number = body.student_number;
      if (!student_number) return json({ error: "student_number is required" }, 400);
      const { data, error } = await admin.rpc("lookup_student_for_registration", {
        p_student_number: student_number,
      });
      if (error) return json({ error: "Could not look up that student number." }, 500);
      return json(data);
    }

    if (action === "submit") {
      const student_number = body.student_number;
      const photo_path = body.photo_path;
      if (!student_number || !photo_path) {
        return json({ error: "student_number and photo_path are required" }, 400);
      }
      const { data, error } = await admin.rpc("submit_student_registration", {
        p_student_number: student_number,
        p_photo_path: photo_path,
      });
      if (error) return json({ error: "Could not submit registration." }, 500);
      return json(data);
    }

    return json({ error: "Unhandled action" }, 400);
  } catch (err) {
    return json({ error: "Unexpected error" }, 500);
  }
});
