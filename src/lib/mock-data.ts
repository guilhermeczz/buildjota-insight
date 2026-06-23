// Dados mockados para o MVP enquanto o Supabase não está conectado.
// Estrutura espelha as tabelas planejadas no Supabase.

export type Familia = {
  id: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  created_at: string;
};

export type Fornecedor = {
  id: string;
  nome: string;
  site_url: string;
  login_url: string;
  tipo_consulta: "SKU" | "URL" | "BUSCA";
  observacoes: string;
  ativo: boolean;
};

export type Produto = {
  id: string;
  sku_interno: string;
  nome: string;
  familia_id: string;
  unidade: string;
  preco_atual: number;
  observacoes: string;
  ativo: boolean;
};

export type MapeamentoSku = {
  id: string;
  produto_id: string;
  fornecedor_id: string;
  sku_fornecedor: string;
  url_produto: string;
  unidade_equivalente: string;
  seletor_preco?: string;
  observacoes: string;
  ativo: boolean;
  ultimo_preco?: number;
  ultima_atualizacao?: string;
  status_coleta?: "sucesso" | "erro" | "pendente";
};

export type HistoricoPreco = {
  id: string;
  mapeamento_id: string;
  preco_construjota: number;
  preco_fornecedor: number;
  diferenca_valor: number;
  diferenca_percentual: number;
  status: "sucesso" | "erro";
  mensagem_erro?: string;
  coletado_em: string;
};

export type ExecucaoRobo = {
  id: string;
  status: "sucesso" | "parcial" | "erro";
  origem: "GitHub Actions" | "Manual" | "Worker/VPS";
  iniciado_em: string;
  finalizado_em: string;
  total_processados: number;
  total_sucesso: number;
  total_erro: number;
  mensagem: string;
  tempo_execucao_segundos: number;
};

export const familias: Familia[] = [
  { id: "f1", nome: "OTTO - Vedacit e Vedalit", descricao: "Linha de impermeabilizantes Vedacit/Vedalit no fornecedor OTTO (MVP inicial)", ativo: true, created_at: "2025-05-01" },
  { id: "f2", nome: "AMANCO", descricao: "Tubos e conexões hidráulicas Amanco", ativo: true, created_at: "2025-05-01" },
  { id: "f3", nome: "TIGRE", descricao: "Tubos e conexões Tigre", ativo: true, created_at: "2025-05-01" },
  { id: "f4", nome: "Elétrica", descricao: "Materiais elétricos diversos", ativo: true, created_at: "2025-05-01" },
  { id: "f5", nome: "Hidráulica", descricao: "Materiais hidráulicos diversos", ativo: true, created_at: "2025-05-01" },
  { id: "f6", nome: "Construção Geral", descricao: "Itens de construção em geral", ativo: false, created_at: "2025-05-01" },
];

export const fornecedores: Fornecedor[] = [
  {
    id: "for1",
    nome: "OTTO",
    site_url: "https://www.otto.com.br",
    login_url: "https://www.otto.com.br/login",
    tipo_consulta: "SKU",
    observacoes: "MVP inicial para linha Vedacit/Vedalit",
    ativo: true,
  },
];

export const produtos: Produto[] = [
  { id: "p1", sku_interno: "CJ-1001", nome: "Vedalit 18L", familia_id: "f1", unidade: "Balde 18L", preco_atual: 210.0, observacoes: "", ativo: true },
  { id: "p2", sku_interno: "CJ-1002", nome: "Vedacit 18L", familia_id: "f1", unidade: "Balde 18L", preco_atual: 205.0, observacoes: "", ativo: true },
  { id: "p3", sku_interno: "CJ-1003", nome: "Vedacit 3,6L", familia_id: "f1", unidade: "Balde 3,6L", preco_atual: 52.9, observacoes: "", ativo: true },
  { id: "p4", sku_interno: "CJ-1004", nome: "Vedalit 3,6L", familia_id: "f1", unidade: "Balde 3,6L", preco_atual: 58.9, observacoes: "", ativo: true },
  { id: "p5", sku_interno: "CJ-1005", nome: "Vedapren Parede 18L", familia_id: "f1", unidade: "Balde 18L", preco_atual: 199.9, observacoes: "", ativo: true },
];

export const mapeamentos: MapeamentoSku[] = [
  { id: "m1", produto_id: "p1", fornecedor_id: "for1", sku_fornecedor: "OTTO-88990", url_produto: "https://www.otto.com.br/p/OTTO-88990", unidade_equivalente: "Balde 18L", observacoes: "", ativo: true, ultimo_preco: 186.9, ultima_atualizacao: "2025-05-20T08:00:00", status_coleta: "sucesso" },
  { id: "m2", produto_id: "p2", fornecedor_id: "for1", sku_fornecedor: "OTTO-88991", url_produto: "https://www.otto.com.br/p/OTTO-88991", unidade_equivalente: "Balde 18L", observacoes: "", ativo: true, ultimo_preco: 215.5, ultima_atualizacao: "2025-05-20T08:00:00", status_coleta: "sucesso" },
  { id: "m3", produto_id: "p3", fornecedor_id: "for1", sku_fornecedor: "OTTO-88992", url_produto: "https://www.otto.com.br/p/OTTO-88992", unidade_equivalente: "Balde 3,6L", observacoes: "", ativo: true, ultimo_preco: 49.9, ultima_atualizacao: "2025-05-20T08:00:00", status_coleta: "sucesso" },
  { id: "m4", produto_id: "p4", fornecedor_id: "for1", sku_fornecedor: "OTTO-88993", url_produto: "https://www.otto.com.br/p/OTTO-88993", unidade_equivalente: "Balde 3,6L", observacoes: "", ativo: true, ultimo_preco: 58.9, ultima_atualizacao: "2025-05-20T08:00:00", status_coleta: "sucesso" },
  { id: "m5", produto_id: "p5", fornecedor_id: "for1", sku_fornecedor: "OTTO-88994", url_produto: "https://www.otto.com.br/p/OTTO-88994", unidade_equivalente: "Balde 18L", observacoes: "", ativo: true, ultimo_preco: 189.9, ultima_atualizacao: "2025-05-20T08:00:00", status_coleta: "sucesso" },
];

// Gera histórico fictício de 7 dias para cada mapeamento.
function buildHistorico(): HistoricoPreco[] {
  const out: HistoricoPreco[] = [];
  const baseDate = new Date("2025-05-14T08:00:00");
  mapeamentos.forEach((m) => {
    const produto = produtos.find((p) => p.id === m.produto_id)!;
    for (let d = 0; d < 7; d++) {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() + d);
      const variation = (Math.sin(d + parseInt(m.id.slice(1))) * 0.04 + 1);
      const precoFor = +(m.ultimo_preco! * variation).toFixed(2);
      const dif = +(precoFor - produto.preco_atual).toFixed(2);
      const difPct = +((dif / produto.preco_atual) * 100).toFixed(2);
      out.push({
        id: `${m.id}-h${d}`,
        mapeamento_id: m.id,
        preco_construjota: produto.preco_atual,
        preco_fornecedor: precoFor,
        diferenca_valor: dif,
        diferenca_percentual: difPct,
        status: "sucesso",
        coletado_em: date.toISOString(),
      });
    }
  });
  // Adiciona uma coleta com erro
  out.push({
    id: "err-1",
    mapeamento_id: "m5",
    preco_construjota: 199.9,
    preco_fornecedor: 0,
    diferenca_valor: 0,
    diferenca_percentual: 0,
    status: "erro",
    mensagem_erro: "Timeout ao acessar a página do produto no fornecedor",
    coletado_em: "2025-05-20T08:05:12",
  });
  return out;
}

export const historico: HistoricoPreco[] = buildHistorico();

export const execucoes: ExecucaoRobo[] = [
  { id: "e1", status: "sucesso", origem: "GitHub Actions", iniciado_em: "2025-05-20T08:00:03", finalizado_em: "2025-05-20T08:05:42", total_processados: 124, total_sucesso: 117, total_erro: 7, mensagem: "Coleta concluída com 7 erros", tempo_execucao_segundos: 339 },
  { id: "e2", status: "sucesso", origem: "GitHub Actions", iniciado_em: "2025-05-19T08:00:01", finalizado_em: "2025-05-19T08:04:58", total_processados: 124, total_sucesso: 122, total_erro: 2, mensagem: "Coleta concluída", tempo_execucao_segundos: 297 },
  { id: "e3", status: "parcial", origem: "Manual", iniciado_em: "2025-05-18T14:22:00", finalizado_em: "2025-05-18T14:25:11", total_processados: 60, total_sucesso: 55, total_erro: 5, mensagem: "Execução manual parcial", tempo_execucao_segundos: 191 },
  { id: "e4", status: "erro", origem: "GitHub Actions", iniciado_em: "2025-05-17T08:00:00", finalizado_em: "2025-05-17T08:00:42", total_processados: 0, total_sucesso: 0, total_erro: 124, mensagem: "Erro de autenticação no fornecedor OTTO", tempo_execucao_segundos: 42 },
];

// Helpers
export const getFamiliaNome = (id: string) => familias.find((f) => f.id === id)?.nome ?? "—";
export const getProduto = (id: string) => produtos.find((p) => p.id === id);
export const getFornecedor = (id: string) => fornecedores.find((f) => f.id === id);
export const getMapeamento = (id: string) => mapeamentos.find((m) => m.id === id);

export const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const formatPct = (v: number) =>
  `${v > 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`;
export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
