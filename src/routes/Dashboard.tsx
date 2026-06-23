import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatDateTime, formatPct } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Percent,
  Store,
  TrendingDown,
  TrendingUp,
  XCircle,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type Produto = {
  id: string;
  nome: string;
  sku_interno: string;
  preco_atual: number;
  ativo: boolean;
};

type Concorrente = {
  id: string;
  ativo: boolean;
};

type Mapeamento = {
  id: string;
  sku_concorrente: string;
  ultimo_preco: number | null;
  ultima_atualizacao: string | null;
  status_coleta: "sucesso" | "erro" | "pendente";
  produtos?: Produto | null;
  concorrentes?: { nome: string } | null;
};

type Historico = {
  id: string;
  mapeamento_id: string;
  preco_concorrente: number;
  status: "sucesso" | "erro" | "pendente";
  coletado_em: string;
  mapeamentos_sku?: {
    id: string;
    produtos?: { nome: string; sku_interno: string } | null;
  } | null;
};

type Execucao = {
  id: string;
  status: "sucesso" | "parcial" | "erro" | "pendente";
  iniciado_em: string;
  finalizado_em: string | null;
  total_processados: number;
  total_sucesso: number;
  total_erro: number;
  mensagem: string;
  tempo_execucao_segundos: number;
};

function numeric(value: number | null | undefined) {
  return Number(value ?? 0);
}

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [concorrentes, setConcorrentes] = useState<Concorrente[]>([]);
  const [mapeamentos, setMapeamentos] = useState<Mapeamento[]>([]);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshDashboard() {
    const [
      produtosResult,
      concorrentesResult,
      mapeamentosResult,
      historicoResult,
      execucoesResult,
    ] = await Promise.all([
      supabase.from("produtos").select("id,nome,sku_interno,preco_atual,ativo").order("nome"),
      supabase.from("concorrentes").select("id,ativo"),
      supabase
        .from("mapeamentos_sku")
        .select(
          "id,sku_concorrente,ultimo_preco,ultima_atualizacao,status_coleta,produtos(id,nome,sku_interno,preco_atual,ativo),concorrentes(nome)",
        )
        .eq("ativo", true)
        .order("updated_at", { ascending: false }),
      supabase
        .from("historico_precos")
        .select(
          "id,mapeamento_id,preco_concorrente,status,coletado_em,mapeamentos_sku(id,produtos(nome,sku_interno))",
        )
        .eq("status", "sucesso")
        .order("coletado_em", { ascending: false })
        .limit(300),
      supabase
        .from("execucoes_robo")
        .select(
          "id,status,iniciado_em,finalizado_em,total_processados,total_sucesso,total_erro,mensagem,tempo_execucao_segundos",
        )
        .order("iniciado_em", { ascending: false })
        .limit(5),
    ]);

    if (
      produtosResult.error ||
      concorrentesResult.error ||
      mapeamentosResult.error ||
      historicoResult.error ||
      execucoesResult.error
    ) {
      toast.error("Nao foi possivel carregar o dashboard");
      setLoading(false);
      return;
    }

    setProdutos(
      ((produtosResult.data ?? []) as Produto[]).map((produto) => ({
        ...produto,
        preco_atual: numeric(produto.preco_atual),
      })),
    );
    setConcorrentes((concorrentesResult.data ?? []) as Concorrente[]);
    setMapeamentos(
      ((mapeamentosResult.data ?? []) as Mapeamento[]).map((mapeamento) => ({
        ...mapeamento,
        ultimo_preco: mapeamento.ultimo_preco === null ? null : numeric(mapeamento.ultimo_preco),
        produtos: mapeamento.produtos
          ? { ...mapeamento.produtos, preco_atual: numeric(mapeamento.produtos.preco_atual) }
          : null,
      })),
    );
    setHistorico(
      ((historicoResult.data ?? []) as Historico[]).map((row) => ({
        ...row,
        preco_concorrente: numeric(row.preco_concorrente),
      })),
    );
    setExecucoes((execucoesResult.data ?? []) as Execucao[]);
    setLoading(false);
  }

  useEffect(() => {
    void refreshDashboard();

    const channel = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "historico_precos" }, () => {
        void refreshDashboard();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "execucoes_robo" }, () => {
        void refreshDashboard();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const diffs = useMemo(
    () =>
      mapeamentos
        .map((mapeamento) => {
          const produto = mapeamento.produtos;
          const precoCj = numeric(produto?.preco_atual);
          const precoConcorrente = numeric(mapeamento.ultimo_preco);
          const dif = precoConcorrente - precoCj;
          const difPct = precoCj > 0 ? (dif / precoCj) * 100 : 0;
          return {
            mapeamento,
            produto,
            concorrente: mapeamento.concorrentes,
            precoCj,
            precoConcorrente,
            dif,
            difPct,
          };
        })
        .sort((a, b) => Math.abs(b.difPct) - Math.abs(a.difPct)),
    [mapeamentos],
  );

  const stats = useMemo(() => {
    const comPreco = diffs.filter((item) => item.precoConcorrente > 0 && item.precoCj > 0);
    const acima = comPreco.filter((item) => item.dif > 0).length;
    const abaixo = comPreco.filter((item) => item.dif < 0).length;
    const iguais = comPreco.filter((item) => item.dif === 0).length;
    const mediaPct =
      comPreco.reduce((acc, item) => acc + item.difPct, 0) / Math.max(comPreco.length, 1);

    return { total: comPreco.length, acima, abaixo, iguais, mediaPct };
  }, [diffs]);

  const ultimaExec = execucoes[0];

  const chartData = useMemo(() => {
    const days = Array.from(new Set(historico.map((row) => row.coletado_em.slice(0, 10))))
      .sort()
      .slice(-7);

    const firstMapeamentos = mapeamentos.slice(0, 4);

    return days.map((day) => {
      const row: Record<string, number | string> = {
        dia: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
      };

      firstMapeamentos.forEach((mapeamento) => {
        const produto = mapeamento.produtos;
        if (!produto) return;
        const historicoRow = historico.find(
          (item) => item.mapeamento_id === mapeamento.id && item.coletado_em.startsWith(day),
        );
        row[`${produto.nome} (${produto.sku_interno})`] = historicoRow?.preco_concorrente ?? 0;
      });

      return row;
    });
  }, [historico, mapeamentos]);

  const pieData = [
    { name: "Mais baratos", value: stats.abaixo, color: "var(--success)" },
    { name: "Mais caros", value: stats.acima, color: "var(--destructive)" },
    { name: "Iguais", value: stats.iguais, color: "var(--muted-foreground)" },
  ];

  const cards = [
    {
      icon: Boxes,
      label: "Produtos monitorados",
      value: produtos.filter((produto) => produto.ativo).length,
      sub: "Ativos",
      iconBg: "bg-primary/15 text-primary",
    },
    {
      icon: Store,
      label: "Concorrentes ativos",
      value: concorrentes.filter((concorrente) => concorrente.ativo).length,
      sub: "Ativos",
      iconBg: "bg-primary/15 text-primary",
    },
    {
      icon: TrendingUp,
      label: "Produtos acima do concorrente",
      value: stats.acima,
      sub: `${((stats.acima / Math.max(stats.total, 1)) * 100).toFixed(2)}% do total`,
      valueClass: "text-destructive",
    },
    {
      icon: TrendingDown,
      label: "Produtos abaixo do concorrente",
      value: stats.abaixo,
      sub: `${((stats.abaixo / Math.max(stats.total, 1)) * 100).toFixed(2)}% do total`,
      valueClass: "text-success",
    },
    {
      icon: Percent,
      label: "Diferenca media percentual",
      value: `${stats.mediaPct.toFixed(2).replace(".", ",")}%`,
      sub: "Media geral",
      valueClass: stats.mediaPct >= 0 ? "text-destructive" : "text-success",
    },
    {
      icon: AlertTriangle,
      label: "Coletas com erro",
      value: ultimaExec?.total_erro ?? 0,
      sub: `${(((ultimaExec?.total_erro ?? 0) / Math.max(ultimaExec?.total_processados ?? 0, 1)) * 100).toFixed(2)}% do total`,
      valueClass: "text-destructive",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Card key={card.label} className="shadow-sm">
              <CardContent className="p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.iconBg ?? "bg-primary/15 text-primary"}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="min-h-[32px] text-xs font-medium leading-snug text-muted-foreground">
                  {card.label}
                </div>
                <div className={`mt-2 text-3xl font-bold ${card.valueClass ?? "text-foreground"}`}>
                  {card.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{card.sub}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="shadow-sm xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Maiores diferencas de preco</CardTitle>
            <Button
              size="sm"
              onClick={() => navigate("/relatorios")}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Ver relatorio completo
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU CJ</TableHead>
                  <TableHead>Concorrente</TableHead>
                  <TableHead>SKU Conc.</TableHead>
                  <TableHead>Preco CJ</TableHead>
                  <TableHead>Preco Conc.</TableHead>
                  <TableHead>Diferenca</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Ultima coleta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      Carregando dashboard...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && diffs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      Nenhum preco coletado ainda
                    </TableCell>
                  </TableRow>
                )}
                {diffs.slice(0, 10).map((item) => (
                  <TableRow key={item.mapeamento.id}>
                    <TableCell className="font-medium">{item.produto?.nome ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.produto?.sku_interno ?? "-"}
                    </TableCell>
                    <TableCell>{item.concorrente?.nome ?? "-"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.mapeamento.sku_concorrente}
                    </TableCell>
                    <TableCell>{formatBRL(item.precoCj)}</TableCell>
                    <TableCell>{formatBRL(item.precoConcorrente)}</TableCell>
                    <TableCell
                      className={
                        item.dif > 0
                          ? "font-medium text-destructive"
                          : item.dif < 0
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      {item.dif > 0 ? "+" : ""}
                      {formatBRL(item.dif)}
                    </TableCell>
                    <TableCell
                      className={
                        item.difPct > 0
                          ? "font-medium text-destructive"
                          : item.difPct < 0
                            ? "font-medium text-success"
                            : ""
                      }
                    >
                      {formatPct(item.difPct)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {item.mapeamento.ultima_atualizacao
                        ? formatDateTime(item.mapeamento.ultima_atualizacao)
                        : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-primary/50 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Resumo geral</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={2}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {pieData.map((entry) => (
                  <li key={entry.name} className="flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: entry.color }}
                    />
                    <span className="font-semibold">{entry.value}</span>
                    <span className="text-muted-foreground">- {entry.name}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                <div>
                  Ultima coleta:{" "}
                  <span className="font-medium text-foreground">
                    {ultimaExec?.finalizado_em
                      ? formatDateTime(ultimaExec.finalizado_em)
                      : "Sem coletas"}
                  </span>
                </div>
                <div>
                  Proxima coleta: <span className="font-medium text-foreground">Nao agendada</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Ultima execucao do robo</CardTitle>
              <Badge variant={ultimaExec?.status === "erro" ? "destructive" : "secondary"}>
                {ultimaExec?.status ?? "sem execucao"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm">
              <Row
                label="Inicio"
                value={ultimaExec ? formatDateTime(ultimaExec.iniciado_em) : "-"}
              />
              <Row
                label="Fim"
                value={ultimaExec?.finalizado_em ? formatDateTime(ultimaExec.finalizado_em) : "-"}
              />
              <Row label="Total processados" value={`${ultimaExec?.total_processados ?? 0}`} />
              <Row
                label="Sucesso"
                value={`${ultimaExec?.total_sucesso ?? 0}`}
                valueClass="text-success"
              />
              <Row
                label="Erros"
                value={`${ultimaExec?.total_erro ?? 0}`}
                valueClass="text-destructive"
              />
              <Row
                label="Tempo de execucao"
                value={ultimaExec ? durationLabel(ultimaExec.tempo_execucao_segundos) : "-"}
              />
              <Button
                onClick={() => navigate("/execucoes-robo")}
                className="mt-3 w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Ver todas as execucoes
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Alertas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-3">
                <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <div className="font-medium">{ultimaExec?.total_erro ?? 0} coletas com erro</div>
                  <div className="text-xs text-muted-foreground">
                    Consulte os logs da ultima execucao
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-primary" />
                <div>
                  <div className="font-medium">{mapeamentos.length} mapeamentos ativos</div>
                  <div className="text-xs text-muted-foreground">
                    O robo usa esses mapeamentos para coletar precos
                  </div>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <div>
                  <div className="font-medium">{stats.total} comparacoes com preco coletado</div>
                  <div className="text-xs text-muted-foreground">
                    Dados reais salvos no Supabase
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Evolucao de precos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickFormatter={(value) => `R$ ${value}`}
                />
                <ReTooltip
                  formatter={(value: number) => formatBRL(value)}
                  contentStyle={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {mapeamentos.slice(0, 4).map((mapeamento, index) => {
                  const produto = mapeamento.produtos;
                  if (!produto) return null;
                  const colors = [
                    "var(--primary)",
                    "var(--secondary)",
                    "var(--success)",
                    "#3b82f6",
                  ];
                  return (
                    <Line
                      key={mapeamento.id}
                      type="monotone"
                      dataKey={`${produto.nome} (${produto.sku_interno})`}
                      stroke={colors[index]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  );
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-medium ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}
