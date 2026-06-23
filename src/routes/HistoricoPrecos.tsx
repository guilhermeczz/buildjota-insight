import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { historico, mapeamentos, fornecedores, familias, getProduto, getFornecedor, getMapeamento, formatBRL, formatPct, formatDateTime } from "@/lib/mock-data";

export default function HistoricoPrecos() {
  const [periodo, setPeriodo] = useState("7");
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [fornecedorFilter, setFornecedorFilter] = useState("todos");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [q, setQ] = useState("");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(periodo));

  const rows = historico
    .filter((h) => new Date(h.coletado_em) >= cutoff || periodo === "0")
    .filter((h) => {
      const m = getMapeamento(h.mapeamento_id);
      if (!m) return false;
      const p = getProduto(m.produto_id)!;
      if (familiaFilter !== "todas" && p.familia_id !== familiaFilter) return false;
      if (fornecedorFilter !== "todos" && m.fornecedor_id !== fornecedorFilter) return false;
      if (statusFilter === "sucesso" && h.status !== "sucesso") return false;
      if (statusFilter === "erro" && h.status !== "erro") return false;
      if (statusFilter === "mais-caros" && h.diferenca_valor <= 0) return false;
      if (statusFilter === "mais-baratos" && h.diferenca_valor >= 0) return false;
      if (q) {
        const needle = q.toLowerCase();
        if (!p.nome.toLowerCase().includes(needle) && !p.sku_interno.toLowerCase().includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.coletado_em).getTime() - new Date(a.coletado_em).getTime());

  return (
    <>
      <PageHeader title="Histórico de Preços" description="Todas as coletas executadas pelo robô externo." />

      <Card className="mb-4 shadow-sm">
        <CardContent className="p-5 grid grid-cols-1 md:grid-cols-5 gap-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar produto/SKU..." />
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="0">Todo o período</SelectItem>
            </SelectContent>
          </Select>
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>SKU Forn.</TableHead>
                  <TableHead>Preço CJ</TableHead>
                  <TableHead>Preço Forn.</TableHead>
                  <TableHead>Diferença</TableHead>
                  <TableHead>%</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={10} className="text-center py-10 text-muted-foreground">Nenhum registro encontrado</TableCell></TableRow>
                )}
                {rows.map((h) => {
                  const m = getMapeamento(h.mapeamento_id)!;
                  const p = getProduto(m.produto_id)!;
                  const f = getFornecedor(m.fornecedor_id)!;
                  return (
                    <TableRow key={h.id}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(h.coletado_em)}</TableCell>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sku_interno}</TableCell>
                      <TableCell>{f.nome}</TableCell>
                      <TableCell className="font-mono text-xs">{m.sku_fornecedor}</TableCell>
                      <TableCell>{formatBRL(h.preco_construjota)}</TableCell>
                      <TableCell>{h.status === "erro" ? "—" : formatBRL(h.preco_fornecedor)}</TableCell>
                      <TableCell className={h.diferenca_valor > 0 ? "text-destructive font-medium" : h.diferenca_valor < 0 ? "text-success font-medium" : ""}>
                        {h.status === "erro" ? "—" : `${h.diferenca_valor > 0 ? "+" : ""}${formatBRL(h.diferenca_valor)}`}
                      </TableCell>
                      <TableCell className={h.diferenca_percentual > 0 ? "text-destructive font-medium" : h.diferenca_percentual < 0 ? "text-success font-medium" : ""}>
                        {h.status === "erro" ? "—" : formatPct(h.diferenca_percentual)}
                      </TableCell>
                      <TableCell>
                        {h.status === "sucesso" ? (
                          <Badge className="bg-success text-success-foreground">Sucesso</Badge>
                        ) : (
                          <Badge variant="destructive" title={h.mensagem_erro}>Erro</Badge>
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
