import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Boxes,
  Store,
  TrendingUp,
  TrendingDown,
  Percent,
  AlertTriangle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ReTooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  produtos,
  mapeamentos,
  fornecedores,
  historico,
  execucoes,
  getProduto,
  getFornecedor,
  formatBRL,
  formatPct,
  formatDateTime,
} from "@/lib/mock-data";

const STAT_CARDS = () => {
  const total = mapeamentos.length;
  const ultimos = mapeamentos.map((m) => {
    const p = getProduto(m.produto_id)!;
    const dif = (m.ultimo_preco ?? 0) - p.preco_atual;
    return dif;
  });
  const acima = ultimos.filter((d) => d > 0).length;
  const abaixo = ultimos.filter((d) => d < 0).length;
  const iguais = ultimos.filter((d) => d === 0).length;
  const mediaPct =
    ultimos.reduce((acc, d, i) => acc + (d / produtos[i].preco_atual) * 100, 0) /
    Math.max(ultimos.length, 1);
  return { total, acima, abaixo, iguais, mediaPct };
};

export default function Dashboard() {
  const stats = STAT_CARDS();
  const ultimaExec = execucoes[0];

  // Top diferenças
  const diffs = mapeamentos.map((m) => {
    const p = getProduto(m.produto_id)!;
    const f = getFornecedor(m.fornecedor_id)!;
    const dif = (m.ultimo_preco ?? 0) - p.preco_atual;
    const difPct = (dif / p.preco_atual) * 100;
    return { m, p, f, dif, difPct };
  });

  // Evolução por produto
  const days = Array.from(new Set(historico.filter((h) => h.status === "sucesso").map((h) => h.coletado_em.slice(0, 10)))).sort();
  const chartData = days.map((d) => {
    const row: Record<string, number | string> = { dia: d.slice(8, 10) + "/" + d.slice(5, 7) };
    mapeamentos.slice(0, 4).forEach((m) => {
      const p = getProduto(m.produto_id)!;
      const h = historico.find((x) => x.mapeamento_id === m.id && x.coletado_em.startsWith(d));
      row[`${p.nome} (${p.sku_interno})`] = h?.preco_fornecedor ?? 0;
    });
    return row;
  });

  const pieData = [
    { name: "Mais baratos", value: stats.abaixo, color: "var(--success)" },
    { name: "Mais caros", value: stats.acima, color: "var(--destructive)" },
    { name: "Iguais", value: stats.iguais, color: "var(--muted-foreground)" },
  ];

  const cards = [
    { icon: Boxes, label: "Produtos monitorados", value: produtos.length, sub: "Ativos", iconBg: "bg-secondary" },
    { icon: Store, label: "Fornecedores ativos", value: fornecedores.filter((f) => f.ativo).length, sub: "Ativos", iconBg: "bg-primary text-primary-foreground" },
    { icon: TrendingUp, label: "Produtos acima do concorrente", value: stats.acima, sub: `${((stats.acima / Math.max(stats.total, 1)) * 100).toFixed(2)}% do total`, valueClass: "text-destructive" },
    { icon: TrendingDown, label: "Produtos abaixo do concorrente", value: stats.abaixo, sub: `${((stats.abaixo / Math.max(stats.total, 1)) * 100).toFixed(2)}% do total`, valueClass: "text-success" },
    { icon: Percent, label: "Diferença média percentual", value: `${stats.mediaPct.toFixed(2).replace(".", ",")}%`, sub: "Média geral", valueClass: stats.mediaPct >= 0 ? "text-destructive" : "text-success" },
    { icon: AlertTriangle, label: "Coletas com erro", value: ultimaExec.total_erro, sub: `${((ultimaExec.total_erro / Math.max(ultimaExec.total_processados, 1)) * 100).toFixed(2)}% do total`, valueClass: "text-destructive" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className="shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${c.iconBg ?? "bg-primary/15 text-primary"}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
                <div className="text-xs text-muted-foreground font-medium leading-snug min-h-[32px]">
                  {c.label}
                </div>
                <div className={`mt-2 text-3xl font-bold ${c.valueClass ?? "text-foreground"}`}>
                  {c.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{c.sub}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Maiores diferenças */}
        <Card className="xl:col-span-2 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Maiores diferenças de preço</CardTitle>
            <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
              Ver relatório completo
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>SKU CJ</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>SKU Forn.</TableHead>
                  <TableHead>Preço CJ</TableHead>
                  <TableHead>Preço Forn.</TableHead>
                  <TableHead>Diferença</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Última coleta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {diffs.map(({ m, p, f, dif, difPct }) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{p.sku_interno}</TableCell>
                    <TableCell>{f.nome}</TableCell>
                    <TableCell className="text-muted-foreground">{m.sku_fornecedor}</TableCell>
                    <TableCell>{formatBRL(p.preco_atual)}</TableCell>
                    <TableCell>{formatBRL(m.ultimo_preco ?? 0)}</TableCell>
                    <TableCell className={dif > 0 ? "text-destructive font-medium" : dif < 0 ? "text-success font-medium" : ""}>
                      {dif > 0 ? "+" : ""}
                      {formatBRL(dif)}
                    </TableCell>
                    <TableCell className={difPct > 0 ? "text-destructive font-medium" : difPct < 0 ? "text-success font-medium" : ""}>
                      {formatPct(difPct)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {formatDateTime(m.ultima_atualizacao!)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Resumo geral */}
        <div className="space-y-6">
          <Card className="border-primary/50 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Resumo geral</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" innerRadius={55} outerRadius={80} paddingAngle={2}>
                      {pieData.map((e, i) => (
                        <Cell key={i} fill={e.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div className="text-2xl font-bold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {pieData.map((p) => (
                  <li key={p.name} className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
                    <span className="font-semibold">{p.value}</span>
                    <span className="text-muted-foreground">— {p.name}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                <div>Última coleta: <span className="text-foreground font-medium">{formatDateTime(ultimaExec.finalizado_em)}</span></div>
                <div>Próxima coleta: <span className="text-foreground font-medium">21/05/2025 08:00</span></div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Última execução do robô</CardTitle>
              <Badge className="bg-success text-success-foreground">{ultimaExec.status}</Badge>
            </CardHeader>
            <CardContent className="text-sm space-y-1.5">
              <Row label="Início" value={formatDateTime(ultimaExec.iniciado_em)} />
              <Row label="Fim" value={formatDateTime(ultimaExec.finalizado_em)} />
              <Row label="Total processados" value={`${ultimaExec.total_processados}`} />
              <Row label="Sucesso" value={`${ultimaExec.total_sucesso} (${((ultimaExec.total_sucesso / ultimaExec.total_processados) * 100).toFixed(2)}%)`} valueClass="text-success" />
              <Row label="Erros" value={`${ultimaExec.total_erro} (${((ultimaExec.total_erro / ultimaExec.total_processados) * 100).toFixed(2)}%)`} valueClass="text-destructive" />
              <Row label="Tempo de execução" value={`${Math.floor(ultimaExec.tempo_execucao_segundos / 60)}:${String(ultimaExec.tempo_execucao_segundos % 60).padStart(2, "0")}`} />
              <Button className="w-full mt-3 bg-primary text-primary-foreground hover:bg-primary/90">
                Ver todas as execuções
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
                  <div className="font-medium">7 produtos com erro na coleta</div>
                  <div className="text-xs text-muted-foreground">Verifique os logs de execução</div>
                </div>
              </div>
              <div className="flex gap-3">
                <AlertTriangle className="h-5 w-5 shrink-0 text-primary" />
                <div>
                  <div className="font-medium">10 produtos com variação acima de 10%</div>
                  <div className="text-xs text-muted-foreground">Clique para visualizar</div>
                </div>
              </div>
              <div className="flex gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <div>
                  <div className="font-medium">Última coleta concluída com sucesso</div>
                  <div className="text-xs text-muted-foreground">{formatDateTime(ultimaExec.finalizado_em)}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Gráfico */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg">Evolução de preços (últimos 7 dias)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="dia" stroke="var(--muted-foreground)" fontSize={12} />
                <YAxis stroke="var(--muted-foreground)" fontSize={12} tickFormatter={(v) => `R$ ${v}`} />
                <ReTooltip
                  formatter={(v: number) => formatBRL(v)}
                  contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {mapeamentos.slice(0, 4).map((m, i) => {
                  const p = getProduto(m.produto_id)!;
                  const colors = ["var(--primary)", "var(--secondary)", "var(--success)", "#3b82f6"];
                  return (
                    <Line
                      key={m.id}
                      type="monotone"
                      dataKey={`${p.nome} (${p.sku_interno})`}
                      stroke={colors[i]}
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
