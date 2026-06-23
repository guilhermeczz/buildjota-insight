import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ResultadoColeta = {
  mapeamento_id: string;
  preco_construjota: number;
  preco_concorrente: number;
  status: "sucesso" | "erro";
  mensagem_erro?: string;
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(supabaseUrl, serviceRoleKey);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const startedAt = new Date();
  const body = await req.json().catch(() => ({}));
  const resultados = Array.isArray(body.resultados) ? (body.resultados as ResultadoColeta[]) : [];

  const { data: execucao, error: execucaoError } = await supabase
    .from("execucoes_robo")
    .insert({
      status: "pendente",
      origem: body.origem ?? "edge_function",
      iniciado_em: startedAt.toISOString(),
      total_processados: resultados.length,
    })
    .select("id")
    .single();

  if (execucaoError) {
    return new Response(JSON.stringify({ error: execucaoError.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  let totalSucesso = 0;
  let totalErro = 0;

  for (const item of resultados) {
    const diferencaValor =
      item.status === "sucesso"
        ? Number((item.preco_concorrente - item.preco_construjota).toFixed(3))
        : 0;
    const diferencaPercentual =
      item.status === "sucesso" && item.preco_construjota > 0
        ? Number(((diferencaValor / item.preco_construjota) * 100).toFixed(4))
        : 0;

    if (item.status === "sucesso") totalSucesso += 1;
    if (item.status === "erro") totalErro += 1;

    await supabase.from("historico_precos").insert({
      mapeamento_id: item.mapeamento_id,
      preco_construjota: item.preco_construjota,
      preco_concorrente: item.preco_concorrente,
      diferenca_valor: diferencaValor,
      diferenca_percentual: diferencaPercentual,
      status: item.status,
      mensagem_erro: item.mensagem_erro ?? null,
      coletado_em: new Date().toISOString(),
    });

    await supabase
      .from("mapeamentos_sku")
      .update({
        ultimo_preco: item.status === "sucesso" ? item.preco_concorrente : null,
        ultima_atualizacao: new Date().toISOString(),
        status_coleta: item.status,
      })
      .eq("id", item.mapeamento_id);
  }

  const finishedAt = new Date();
  const status = totalErro === 0 ? "sucesso" : totalSucesso === 0 ? "erro" : "parcial";

  await supabase
    .from("execucoes_robo")
    .update({
      status,
      finalizado_em: finishedAt.toISOString(),
      total_sucesso: totalSucesso,
      total_erro: totalErro,
      mensagem: body.mensagem ?? "Coleta registrada",
      tempo_execucao_segundos: Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
    })
    .eq("id", execucao.id);

  return new Response(
    JSON.stringify({ id: execucao.id, status, total_sucesso: totalSucesso, total_erro: totalErro }),
    {
      headers: { "content-type": "application/json" },
    },
  );
});
