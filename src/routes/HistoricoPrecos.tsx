import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDateTime, formatPct, toDateString, toTimestamp } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

type Familia = {
  id: string;
  nome: string;
};

type Concorrente = {
  id: string;
  nome: string;
};

type HistoricoRow = {
  id: string;
  preco_construjota: number;
  preco_concorrente: number | null;
  diferenca_valor: number | null;
  diferenca_percentual: number | null;
  status: "sucesso" | "erro" | "pendente";
  mensagem_erro: string | null;
  coletado_em: string;
  mapeamentos_sku?: {
    sku_concorrente: string;
    produto_id: string;
    concorrente_id: string;
    produtos?: {
      id?: string;
      nome: string;
      sku_interno: string;
      familia_id: string | null;
      familias?: { nome: string } | null;
    } | null;
    concorrentes?: { id?: string; nome: string } | null;
  } | null;
};

function normalizeHistorico(row: HistoricoRow): HistoricoRow {
  const mapeamento = row.mapeamentos_sku;

  return {
    ...row,
    preco_construjota: Number(row.preco_construjota ?? 0),
    preco_concorrente: row.preco_concorrente === null ? null : Number(row.preco_concorrente),
    diferenca_valor: row.diferenca_valor === null ? null : Number(row.diferenca_valor),
    diferenca_percentual:
      row.diferenca_percentual === null ? null : Number(row.diferenca_percentual),
    coletado_em: toDateString(row.coletado_em),
    mapeamentos_sku: mapeamento
      ? {
          ...mapeamento,
          produto_id: mapeamento.produto_id ?? mapeamento.produtos?.id ?? "",
          concorrente_id: mapeamento.concorrente_id ?? mapeamento.concorrentes?.id ?? "",
        }
      : mapeamento,
  };
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function includesSearch(value: string | null | undefined, needle: string) {
  return normalizeSearch(String(value ?? "")).includes(needle);
}

export default function HistoricoPrecos() {
  const [periodo, setPeriodo] = useState("7");
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [concorrenteFilter, setConcorrenteFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [q, setQ] = useState("");
  const [familias, setFamilias] = useState<Familia[]>([]);
  const [concorrentes, setConcorrentes] = useState<Concorrente[]>([]);
  const [rows, setRows] = useState<HistoricoRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshData() {
    const [familiasResult, concorrentesResult, historicoResult] = await Promise.all([
      apiClient.from("familias").select("id,nome").order("nome"),
      apiClient.from("concorrentes").select("id,nome").order("nome"),
      apiClient
        .from("historico_precos")
        .select(
          "id,preco_construjota,preco_concorrente,diferenca_valor,diferenca_percentual,status,mensagem_erro,coletado_em,mapeamentos_sku(sku_concorrente,produto_id,concorrente_id,produtos(nome,sku_interno,familia_id,familias(nome)),concorrentes(nome))",
        )
        .order("coletado_em", { ascending: false })
        .limit(500),
    ]);

    if (familiasResult.error || concorrentesResult.error || historicoResult.error) {
      toast.error("Não foi possível carregar o histórico");
      setLoading(false);
      return;
    }

    setFamilias((familiasResult.data ?? []) as Familia[]);
    setConcorrentes((concorrentesResult.data ?? []) as Concorrente[]);
    setRows(((historicoResult.data ?? []) as HistoricoRow[]).map(normalizeHistorico));
    setLoading(false);
  }

  useEffect(() => {
    void refreshData();
  }, []);

  const filtered = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(periodo));

    return rows.filter((row) => {
      const mapeamento = row.mapeamentos_sku;
      const produto = mapeamento?.produtos;
      const familiaId = produto?.familia_id ?? "";
      const concorrenteId = mapeamento?.concorrente_id ?? mapeamento?.concorrentes?.id ?? "";
      const coletadoEm = toTimestamp(row.coletado_em);

      if (periodo !== "0" && (!coletadoEm || coletadoEm < cutoff.getTime())) return false;
      if (familiaFilter !== "todas" && familiaId !== familiaFilter) return false;
      if (concorrenteFilter !== "todos" && concorrenteId !== concorrenteFilter) return false;
      if (statusFilter === "sucesso" && row.status !== "sucesso") return false;
      if (statusFilter === "erro" && row.status !== "erro") return false;
      if (statusFilter === "mais-caros" && Number(row.diferenca_valor) <= 0) return false;
      if (statusFilter === "mais-baratos" && Number(row.diferenca_valor) >= 0) return false;
      if (q) {
        const needle = normalizeSearch(q);
        if (
          !includesSearch(produto?.nome, needle) &&
          !includesSearch(produto?.sku_interno, needle) &&
          !includesSearch(mapeamento?.sku_concorrente, needle) &&
          !includesSearch(mapeamento?.concorrentes?.nome, needle)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [concorrenteFilter, familiaFilter, periodo, q, rows, statusFilter]);

  return (
    <>
      <PageHeader
        title="Histórico de Preços"
        description="Todas as coletas registradas pelo robô externo."
      />

      <Card className="mb-4 shadow-sm">
        <CardContent className="grid grid-cols-1 gap-3 p-5 md:grid-cols-5">
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Pesquisar produto/SKU..."
          />
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="0">Todo o período</SelectItem>
            </SelectContent>
          </Select>
          <Select value={familiaFilter} onValueChange={setFamiliaFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Família" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as famílias</SelectItem>
              {familias.map((familia) => (
                <SelectItem key={familia.id} value={familia.id}>
                  {familia.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={concorrenteFilter} onValueChange={setConcorrenteFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Concorrente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os concorrentes</SelectItem>
              {concorrentes.map((concorrente) => (
                <SelectItem key={concorrente.id} value={concorrente.id}>
                  {concorrente.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="sucesso">Apenas sucesso</SelectItem>
              <SelectItem value="erro">Coletas com erro</SelectItem>
              <SelectItem value="mais-caros">Produtos mais caros</SelectItem>
              <SelectItem value="mais-baratos">Produtos mais baratos</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/hora</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU CJ</TableHead>
                  <TableHead>Concorrente</TableHead>
                  <TableHead>Cód. Conc.</TableHead>
                  <TableHead>Preço CJ</TableHead>
                  <TableHead>Preço Conc.</TableHead>
                  <TableHead>Diferença</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      Carregando histórico...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      Nenhum registro encontrado
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((row) => {
                  const mapeamento = row.mapeamentos_sku;
                  const produto = mapeamento?.produtos;
                  const concorrente = mapeamento?.concorrentes;

                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {formatDateTime(row.coletado_em)}
                      </TableCell>
                      <TableCell className="font-medium">{produto?.nome ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {produto?.sku_interno ?? "-"}
                      </TableCell>
                      <TableCell>{concorrente?.nome ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {mapeamento?.sku_concorrente ?? "-"}
                      </TableCell>
                      <TableCell>{formatBRL(row.preco_construjota)}</TableCell>
                      <TableCell>
                        {row.preco_concorrente === null ? "-" : formatBRL(row.preco_concorrente)}
                      </TableCell>
                      <TableCell
                        className={
                          Number(row.diferenca_valor) > 0
                            ? "font-medium text-destructive"
                            : Number(row.diferenca_valor) < 0
                              ? "font-medium text-success"
                              : ""
                        }
                      >
                        {row.diferenca_valor === null
                          ? "-"
                          : `${Number(row.diferenca_valor) > 0 ? "+" : ""}${formatBRL(row.diferenca_valor)}`}
                      </TableCell>
                      <TableCell
                        className={
                          Number(row.diferenca_percentual) > 0
                            ? "font-medium text-destructive"
                            : Number(row.diferenca_percentual) < 0
                              ? "font-medium text-success"
                              : ""
                        }
                      >
                        {row.diferenca_percentual === null
                          ? "-"
                          : formatPct(row.diferenca_percentual)}
                      </TableCell>
                      <TableCell>
                        {row.status === "sucesso" ? (
                          <Badge className="bg-success text-success-foreground">Sucesso</Badge>
                        ) : (
                          <Badge variant="destructive" title={row.mensagem_erro ?? undefined}>
                            Erro
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
