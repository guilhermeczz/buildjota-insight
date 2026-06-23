export type Familia = {
  id: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  created_at: string;
};

export type Concorrente = {
  id: string;
  nome: string;
  site_url: string;
  login_url: string;
  tipo_consulta: "SKU" | "URL" | "BUSCA";
  observacoes: string;
  ativo: boolean;
};

export type Fornecedor = Concorrente;

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
  origem: "manual" | "edge_function" | "worker" | "agendado";
  iniciado_em: string;
  finalizado_em: string;
  total_processados: number;
  total_sucesso: number;
  total_erro: number;
  mensagem: string;
  tempo_execucao_segundos: number;
};

export const familias: Familia[] = [];
export const concorrentes: Concorrente[] = [];
export const fornecedores = concorrentes;
export const produtos: Produto[] = [];
export const mapeamentos: MapeamentoSku[] = [];
export const historico: HistoricoPreco[] = [];
export const execucoes: ExecucaoRobo[] = [];

export const getFamiliaNome = (id: string) => familias.find((f) => f.id === id)?.nome ?? "—";
export const getProduto = (id: string) => produtos.find((p) => p.id === id);
export const getConcorrente = (id: string) => concorrentes.find((c) => c.id === id);
export const getFornecedor = getConcorrente;
export const getMapeamento = (id: string) => mapeamentos.find((m) => m.id === id);

export const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const formatPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`;
export const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
};
