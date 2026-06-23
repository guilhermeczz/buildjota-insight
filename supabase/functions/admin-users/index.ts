import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type UserRole = "admin" | "operador" | "visualizador";

type AdminUsersBody =
  | {
      action: "create";
      nome: string;
      email: string;
      password: string;
      role: UserRole;
      ativo: boolean;
    }
  | {
      action: "update";
      id: string;
      nome: string;
      email: string;
      role: UserRole;
      ativo: boolean;
      password?: string;
    }
  | {
      action: "delete";
      id: string;
    };

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const adminClient = createClient(supabaseUrl, serviceRoleKey);

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization)
    return { ok: false as const, response: json({ error: "Não autenticado." }, 401) };

  const token = authorization.replace("Bearer ", "");
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);

  if (userError || !userData.user) {
    return { ok: false as const, response: json({ error: "Sessão inválida." }, 401) };
  }

  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("id,role,ativo")
    .eq("id", userData.user.id)
    .single();

  if (profileError || !profile?.ativo || profile.role !== "admin") {
    return {
      ok: false as const,
      response: json({ error: "Acesso restrito a administradores." }, 403),
    };
  }

  return { ok: true as const, userId: userData.user.id };
}

function validateEmail(email: string) {
  return /^\S+@\S+\.\S+$/.test(email);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = await requireAdmin(req);
  if (!admin.ok) return admin.response;

  const body = (await req.json().catch(() => null)) as AdminUsersBody | null;
  if (!body?.action) return json({ error: "Requisição inválida." }, 400);

  if (body.action === "create") {
    if (
      !body.nome?.trim() ||
      !validateEmail(body.email) ||
      !body.password ||
      body.password.length < 6
    ) {
      return json(
        { error: "Informe nome, e-mail válido e senha com no mínimo 6 caracteres." },
        400,
      );
    }

    const { data, error } = await adminClient.auth.admin.createUser({
      email: body.email.trim(),
      password: body.password,
      email_confirm: true,
      user_metadata: {
        nome: body.nome.trim(),
        role: body.role,
      },
    });

    if (error || !data.user)
      return json({ error: error?.message ?? "Não foi possível criar usuário." }, 400);

    const profile = {
      id: data.user.id,
      nome: body.nome.trim(),
      email: body.email.trim(),
      role: body.role,
      ativo: body.ativo,
    };

    const { error: profileError } = await adminClient.from("profiles").upsert(profile);
    if (profileError) return json({ error: profileError.message }, 400);

    return json({ user: profile });
  }

  if (body.action === "update") {
    if (!body.id || !body.nome?.trim() || !validateEmail(body.email)) {
      return json({ error: "Informe nome e e-mail válido." }, 400);
    }

    if (body.id === admin.userId && body.ativo === false) {
      return json({ error: "Você não pode desativar o próprio usuário." }, 400);
    }

    const authPayload: Parameters<typeof adminClient.auth.admin.updateUserById>[1] = {
      email: body.email.trim(),
      user_metadata: {
        nome: body.nome.trim(),
        role: body.role,
      },
    };

    if (body.password) {
      if (body.password.length < 6) {
        return json({ error: "A senha deve ter no mínimo 6 caracteres." }, 400);
      }
      authPayload.password = body.password;
    }

    const { error } = await adminClient.auth.admin.updateUserById(body.id, authPayload);
    if (error) return json({ error: error.message }, 400);

    const profile = {
      id: body.id,
      nome: body.nome.trim(),
      email: body.email.trim(),
      role: body.role,
      ativo: body.ativo,
    };

    const { error: profileError } = await adminClient
      .from("profiles")
      .update(profile)
      .eq("id", body.id);
    if (profileError) return json({ error: profileError.message }, 400);

    return json({ user: profile });
  }

  if (body.action === "delete") {
    if (!body.id) return json({ error: "Usuário inválido." }, 400);
    if (body.id === admin.userId)
      return json({ error: "Você não pode excluir o próprio usuário." }, 400);

    const { error } = await adminClient.auth.admin.deleteUser(body.id);
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  }

  return json({ error: "Ação inválida." }, 400);
});
