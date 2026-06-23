import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Power, History, ExternalLink } from "lucide-react";
import { mapeamentos as initial, produtos, fornecedores, getProduto, getFornecedor, getFamiliaNome, formatBRL, formatDateTime, type MapeamentoSku } from "@/lib/mock-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Link } from "react-router-dom";

export default function MapeamentosSku() {
  const [list, setList] = useState<MapeamentoSku[]>(initial);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MapeamentoSku | null>(null);
  const [form, setForm] = useState<Partial<MapeamentoSku>>({});

  const filtered = list.filter((m) => {
    if (!q) return true;
    const p = getProduto(m.produto_id);
    const f = getFornecedor(m.fornecedor_id);
    const needle = q.toLowerCase();
    return (
      p?.nome.toLowerCase().includes(needle) ||
      p?.sku_interno.toLowerCase().includes(needle) ||
      m.sku_fornecedor.toLowerCase().includes(needle) ||
      f?.nome.toLowerCase().includes(needle)
    );
  });

  function openNew() {
    setEditing(null);
    setForm({ produto_id: produtos[0]?.id, fornecedor_id: fornecedores[0]?.id, sku_fornecedor: "", url_produto: "", unidade_equivalente: "", observacoes: "" });
    setOpen(true);
  }
  function openEdit(m: MapeamentoSku) {
    setEditing(m);
    setForm(m);
    setOpen(true);
  }
  function save() {
    if (!form.produto_id || !form.fornecedor_id || !form.sku_fornecedor) {
      toast.error("Preencha produto, fornecedor e SKU do fornecedor");
      return;
    }
    if (editing) {
      setList((l) => l.map((x) => (x.id === editing.id ? { ...x, ...(form as MapeamentoSku) } : x)));
      toast.success("Mapeamento atualizado");
    } else {
      setList((l) => [...l, { ...(form as MapeamentoSku), id: `m${Date.now()}`, ativo: true }]);
      toast.success("Mapeamento criado");
    }
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="Mapeamento de SKUs"
        description="Configure manualmente: este SKU da ConstruJota deve ser comparado com este SKU do fornecedor."
        actions={
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1" /> Novo mapeamento
          </Button>
        }
      />

      <Card className="mb-4 bg-secondary text-secondary-foreground">
        <CardContent className="p-4 text-sm">
          A comparação não depende da descrição do produto — depende deste mapeamento manual.
          Cada mapeamento conecta um SKU interno da ConstruJota a um SKU equivalente em um fornecedor.
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar..." className="pl-9" />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto CJ</TableHead>
                  <TableHead>SKU CJ</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>SKU Forn.</TableHead>
                  <TableHead>Família</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Último preço</TableHead>
                  <TableHead>Última atualização</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((m) => {
                  const p = getProduto(m.produto_id)!;
                  const f = getFornecedor(m.fornecedor_id)!;
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{p.nome}</TableCell>
                      <TableCell className="font-mono text-xs">{p.sku_interno}</TableCell>
                      <TableCell>{f.nome}</TableCell>
                      <TableCell className="font-mono text-xs">{m.sku_fornecedor}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{getFamiliaNome(p.familia_id)}</TableCell>
                      <TableCell>
                        <a href={m.url_produto} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline text-xs">
                          abrir <ExternalLink className="h-3 w-3" />
                        </a>
                      </TableCell>
                      <TableCell>{m.ultimo_preco ? formatBRL(m.ultimo_preco) : "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{m.ultima_atualizacao ? formatDateTime(m.ultima_atualizacao) : "—"}</TableCell>
                      <TableCell>
                        {m.status_coleta === "sucesso" && <Badge className="bg-success text-success-foreground">Sucesso</Badge>}
                        {m.status_coleta === "erro" && <Badge variant="destructive">Erro</Badge>}
                        {!m.status_coleta && <Badge variant="secondary">Pendente</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost"><Link to="/historico" title="Histórico"><History className="h-4 w-4" /></Link></Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(m)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setList((l) => l.map((x) => x.id === m.id ? { ...x, ativo: !x.ativo } : x))}><Power className="h-4 w-4" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar mapeamento" : "Novo mapeamento de SKU"}</DialogTitle>
            <DialogDescription>Defina a equivalência entre o produto interno e o produto do fornecedor.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Produto ConstruJota</Label>
              <Select value={form.produto_id} onValueChange={(v) => setForm({ ...form, produto_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {produtos.map((p) => <SelectItem key={p.id} value={p.id}>{p.sku_interno} — {p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Fornecedor</Label>
              <Select value={form.fornecedor_id} onValueChange={(v) => setForm({ ...form, fornecedor_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fornecedores.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>SKU no fornecedor</Label><Input value={form.sku_fornecedor ?? ""} onChange={(e) => setForm({ ...form, sku_fornecedor: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Unidade equivalente</Label><Input value={form.unidade_equivalente ?? ""} onChange={(e) => setForm({ ...form, unidade_equivalente: e.target.value })} /></div>
            <div className="space-y-1.5 col-span-2"><Label>URL do produto</Label><Input value={form.url_produto ?? ""} onChange={(e) => setForm({ ...form, url_produto: e.target.value })} /></div>
            <div className="space-y-1.5 col-span-2"><Label>Seletor de preço (opcional)</Label><Input value={form.seletor_preco ?? ""} onChange={(e) => setForm({ ...form, seletor_preco: e.target.value })} placeholder="ex: .product-price__value" /></div>
            <div className="space-y-1.5 col-span-2"><Label>Observações</Label><Textarea value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} className="bg-primary text-primary-foreground hover:bg-primary/90">Salvar mapeamento</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
