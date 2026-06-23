import { createClient } from "@supabase/supabase-js";

export function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL nao configurada");
  }

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY nao configurada");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function fetchActiveMappings(supabase, filters = {}) {
  const { data, error } = await supabase
    .from("mapeamentos_sku")
    .select(
      "id,sku_concorrente,url_produto,seletor_preco,produto_id,concorrente_id,status_coleta,produtos(id,nome,sku_interno,familia_id,preco_atual,ativo),concorrentes(id,nome,site_url,login_url,ativo)",
    )
    .eq("ativo", true)
    .eq("produtos.ativo", true)
    .eq("concorrentes.ativo", true)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Falha ao buscar mapeamentos: ${error.message}`);
  }

  return (data ?? [])
    .filter((item) => item.produtos && item.concorrentes)
    .filter((item) => {
      if (filters.mapeamentoId && item.id !== filters.mapeamentoId) return false;
      if (filters.produtoId && item.produto_id !== filters.produtoId) return false;
      if (filters.familiaId && item.produtos?.familia_id !== filters.familiaId) return false;
      if (filters.failedOnly && item.status_coleta !== "erro") return false;
      return true;
    });
}

export async function registerResults(resultados, mensagem) {
  const url = process.env.SUPABASE_URL;
  const token = process.env.SUPABASE_FUNCTION_JWT ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("SUPABASE_URL nao configurada");
  if (!token) throw new Error("SUPABASE_FUNCTION_JWT ou SUPABASE_SERVICE_ROLE_KEY nao configurada");

  const response = await fetch(`${url}/functions/v1/registrar-coleta`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      origem: "worker",
      mensagem,
      resultados,
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`Falha ao registrar coleta: ${response.status} ${JSON.stringify(body)}`);
  }

  return body;
}
