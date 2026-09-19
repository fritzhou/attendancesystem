import { createClient } from "jsr:@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify who is calling, using THEIR token against the anon client
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

    // Service-role client for the privileged admin-role check + user creation
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role, is_active")
      .eq("id", userData.user.id)
      .single();

    if (!callerProfile || callerProfile.role !== "admin" || !callerProfile.is_active) {
      return json({ error: "Not authorized" }, 403);
    }

    const body = await req.json();
    const { email, password, full_name, employee_number } = body;

    if (!email || !password || !full_name) {
      return json({ error: "email, password, and full_name are required" }, 400);
    }
    if (String(password).length < 8) {
      return json({ error: "Password must be at least 8 characters" }, 400);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      return json({ error: createError?.message || "Could not create account" }, 400);
    }

    const newUserId = created.user.id;

    const { error: profileError } = await adminClient.from("profiles").insert({
      id: newUserId,
      full_name,
      email,
      role: "teacher",
      is_active: true,
    });

    if (profileError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return json({ error: "Could not create profile: " + profileError.message }, 400);
    }

    const { error: teacherError } = await adminClient.from("teachers").insert({
      profile_id: newUserId,
      full_name,
      employee_number: employee_number || null,
    });

    if (teacherError) {
      await adminClient.auth.admin.deleteUser(newUserId); // cascades profile too
      return json({ error: "Could not create teacher record: " + teacherError.message }, 400);
    }

    return json({ success: true, teacher_id: newUserId });
  } catch (err) {
    return json({ error: (err as Error).message || "Unexpected error" }, 500);
  }
});
