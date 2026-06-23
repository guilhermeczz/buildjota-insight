import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, FileSpreadsheet } from "lucide-react";
import { mapeamentos, fornecedores, familias, historico, getProduto, getFornecedor, formatBRL, formatPct } from "@/lib/mock-data";
import { toast } from "sonner";

type Row = {
  produto: string;
  sku: string;
  fornecedor: string;
  skuFor: string;
  familia: string;
  precoCJ: number;
  precoFor: number;
  dif: number;
  difPct: number;
};

function buildComparacao(): Row[] {
  return mapeamentos.map((m) => {
    const p = getProduto(m.produto_id)!;
    const f = getFornecedor(m.fornecedor_id)!;
    const precoFor = m.ultimo_preco ?? 0;
    const dif = precoFor - p.preco_atual;
    const difPct = (dif / p.preco_atual) * 100;
    return {
      produto: p.nome,
      sku: p.sku_interno,
      fornecedor: f.nome,
      skuFor: m.sku_fornecedor,
      familia: familias.find((fa) => fa.id === p.familia_id)?.nome ?? "—",
      precoCJ: p.preco_atual,
      precoFor,
      dif,
      difPct,
    };
  });
}

function downloadCSV(rows: Row[], filename: string) {
  const header = ["Produto", "SKU CJ", "Fornecedor", "SKU Forn.", "Família", "Preço CJ", "Preço Forn.", "Diferença R$", "Diferença %"];
  const csv = [header.join(";"), ...rows.map((r) => [r.produto, r.sku, r.fornecedor, r.skuFor, r.familia, r.precoCJ.toFixed(2), r.precoFor.toFixed(2), r.dif.toFixed(2), r.difPct.toFixed(2)].join(";"))].join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  toast.success("Exportação concluída");
}

function RelatorioTable({ rows, title, filename }: { rows: Row[]; title: string; filename: string }) {
  return (
    <Card className="shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => downloadCSV(rows, filename + ".csv")}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button size="sm" variant="outline" onClick={() => downloadCSV(rows, filename + ".xls")}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Excel
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>SKU CJ</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>SKU Forn.</TableHead>
                <TableHead>Família</TableHead>
                <TableHead>Preço CJ</TableHead>
                <TableHead>Preço Forn.</TableHead>
                <TableHead>Diferença</TableHead>
                <TableHead>%</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">Sem dados</TableCell></TableRow>}
              {rows.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.produto}</TableCell>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                  <TableCell>{r.fornecedor}</TableCell>
                  <TableCell className="font-mono text-xs">{r.skuFor}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.familia}</TableCell>
                  <TableCell>{formatBRL(r.precoCJ)}</TableCell>
                  <TableCell>{formatBRL(r.precoFor)}</TableCell>
                  <TableCell className={r.dif > 0 ? "text-destructive font-medium" : r.dif < 0 ? "text-success font-medium" : ""}>
                    {r.dif > 0 ? "+" : ""}{formatBRL(r.dif)}
                  </TableCell>
                  <TableCell className={r.difPct > 0 ? "text-destructive font-medium" : r.difPct < 0 ? "text-success font-medium" : ""}>
                    {formatPct(r.difPct)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Relatorios() {
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [fornecedorFilter, setFornecedorFilter] = useState("todos");

  const base = buildComparacao().filter((r) => {
    if (familiaFilter !== "todas" && r.familia !== familias.find((f) => f.id === familiaFilter)?.nome) return false;
    if (fornecedorFilter !== "todos" && r.fornecedor !== fornecedores.find((f) => f.id === fornecedorFilter)?.nome) return false;
    return true;
  });

  const acima = base.filter((r) => r.dif > 0);
  const abaixo = base.filter((r) => r.dif < 0);

  const porFamilia = Object.entries(
    base.reduce<Record<string, Row[]>>((acc, r) => ((acc[r.familia] ||= []).push(r), acc), {}),
  );
  const porFornecedor = Object.entries(
    base.reduce<Record<string, Row[]>>((acc, r) => ((acc[r.fornecedor] ||= []).push(r), acc), {}),
  );

  const erros = historico.filter((h) => h.status === "erro").map((h) => {
    const m = mapeamentos.find((mm) => mm.id === h.mapeamento_id)!;
    const p = getProduto(m.produto_id)!;
    const f = getFornecedor(m.fornecedor_id)!;
    return { ...h, p, f, m };
  });

  return (
    <>
      <PageHeader title="Relatórios" description="Relatórios gerenciais. Exporte em CSV ou Excel." />

      <Card className="mb-4 shadow-sm">
        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select value={familiaFilter} onValueChange={setFamiliaFilter}>
            <SelectTrigger><SelectValue placeholder="Família" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as famílias</SelectItem>
              {familias.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={fornecedorFilter} onValueChange={setFornecedorFilter}>
            <SelectTrigger><SelectValue placeholder="Fornecedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os fornecedores</SelectItem>
              {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select defaultValue="7">
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Tabs defaultValue="atual" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="atual">Comparação atual</TabsTrigger>
          <TabsTrigger value="acima">Acima do mercado</TabsTrigger>
          <TabsTrigger value="abaixo">Abaixo do mercado</TabsTrigger>
          <TabsTrigger value="familia">Por família</TabsTrigger>
          <TabsTrigger value="fornecedor">Por fornecedor</TabsTrigger>
          <TabsTrigger value="variacao">Variação de preços</TabsTrigger>
          <TabsTrigger value="erros">Erros de coleta</TabsTrigger>
        </TabsList>

        <TabsContent value="atual"><RelatorioTable rows={base} title="Comparação atual ConstruJota × Fornecedores" filename="comparacao-atual" /></TabsContent>
        <TabsContent value="acima"><RelatorioTable rows={acima} title="Produtos com preço acima do mercado" filename="acima-mercado" /></TabsContent>
        <TabsContent value="abaixo"><RelatorioTable rows={abaixo} title="Produtos com preço abaixo do mercado" filename="abaixo-mercado" /></TabsContent>
        <TabsContent value="familia" className="space-y-4">
          {porFamilia.map(([nome, rows]) => <RelatorioTable key={nome} rows={rows} title={`Família: ${nome}`} filename={`familia-${nome}`} />)}
        </TabsContent>
        <TabsContent value="fornecedor" className="space-y-4">
          {porFornecedor.map(([nome, rows]) => <RelatorioTable key={nome} rows={rows} title={`Fornecedor: ${nome}`} filename={`fornecedor-${nome}`} />)}
        </TabsContent>
        <TabsContent value="variacao">
          <Card className="shadow-sm">
            <CardHeader><CardTitle className="text-base">Variação de preços ao longo do tempo</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead>Fornecedor</TableHead>
                      <TableHead>Menor preço</TableHead>
                      <TableHead>Maior preço</TableHead>
                      <TableHead>Variação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mapeamentos.map((m) => {
                      const hs = historico.filter((h) => h.mapeamento_id === m.id && h.status === "sucesso").map((h) => h.preco_fornecedor);
                      const min = Math.min(...hs);
                      const max = Math.max(...hs);
                      const variacao = ((max - min) / min) * 100;
                      const p = getProduto(m.produto_id)!;
                      const f = getFornecedor(m.fornecedor_id)!;
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{p.nome}</TableCell>
                          <TableCell>{f.nome}</TableCell>
                          <TableCell>{formatBRL(min)}</TableCell>
                          <TableCell>{formatBRL(max)}</TableCell>
                          <TableCell className={variacao > 5 ? "text-primary font-medium" : ""}>{variacao.toFixed(2)}%</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="erros">
          <Card className="shadow-sm">
            <CardHeader><CardTitle className="text-base">Erros de coleta</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>Fornecedor</TableHead><TableHead>Mensagem</TableHead><TableHead>Data</TableHead></TableRow></TableHeader>
                <TableBody>
                  {erros.length === 0 && <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum erro registrado</TableCell></TableRow>}
                  {erros.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.p.nome}</TableCell>
                      <TableCell>{e.f.nome}</TableCell>
                      <TableCell className="text-sm"><Badge variant="destructive" className="mr-2">Erro</Badge>{e.mensagem_erro}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(e.coletado_em).toLocaleString("pt-BR")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
