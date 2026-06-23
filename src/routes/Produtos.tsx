import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Power } from "lucide-react";
import { produtos as initial, familias, getFamiliaNome, formatBRL, type Produto } from "@/lib/mock-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function Produtos() {
  const [list, setList] = useState<Produto[]>(initial);
  const [q, setQ] = useState("");
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Produto | null>(null);
  const [form, setForm] = useState<Partial<Produto>>({});

  const filtered = list.filter((p) => {
    if (q && !p.nome.toLowerCase().includes(q.toLowerCase()) && !p.sku_interno.toLowerCase().includes(q.toLowerCase())) return false;
    if (familiaFilter !== "todas" && p.familia_id !== familiaFilter) return false;
    if (statusFilter === "ativos" && !p.ativo) return false;
    if (statusFilter === "inativos" && p.ativo) return false;
    return true;
  });

  function openNew() {
    setEditing(null);
    setForm({ sku_interno: "", nome: "", familia_id: familias[0]?.id, unidade: "", preco_atual: 0, observacoes: "" });
    setOpen(true);
  }
  function openEdit(p: Produto) {
    setEditing(p);
    setForm(p);
    setOpen(true);
  }
  function save() {
    if (!form.nome || !form.sku_interno) {
      toast.error("Informe SKU e nome");
      return;
    }
    if (editing) {
      setList((l) => l.map((x) => (x.id === editing.id ? { ...x, ...(form as Produto) } : x)));
      toast.success("Produto atualizado");
    } else {
      setList((l) => [...l, { ...(form as Produto), id: `p${Date.now()}`, ativo: true }]);
      toast.success("Produto cadastrado");
    }
    setOpen(false);
  }
  function toggleAtivo(p: Produto) {
    setList((l) => l.map((x) => (x.id === p.id ? { ...x, ativo: !x.ativo } : x)));
  }

  return (
    <>
      <PageHeader
        title="Produtos ConstruJota"
        description="Catálogo interno de produtos que serão monitorados."
        actions={
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1" /> Novo produto
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative sm:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar por SKU ou nome..." className="pl-9" />
            </div>
            <Select value={familiaFilter} onValueChange={setFamiliaFilter}>
              <SelectTrigger><SelectValue placeholder="Família" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as famílias</SelectItem>
                {familias.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="ativos">Ativos</SelectItem>
                <SelectItem value="inativos">Inativos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>SKU</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Família</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead>Preço atual</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Nenhum produto encontrado</TableCell>
                  </TableRow>
                )}
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.sku_interno}</TableCell>
                    <TableCell className="font-medium">{p.nome}</TableCell>
                    <TableCell>{getFamiliaNome(p.familia_id)}</TableCell>
                    <TableCell className="text-muted-foreground">{p.unidade}</TableCell>
                    <TableCell>{formatBRL(p.preco_atual)}</TableCell>
                    <TableCell>{p.ativo ? <Badge className="bg-success text-success-foreground">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleAtivo(p)}><Power className="h-4 w-4" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>SKU interno</Label>
              <Input value={form.sku_interno ?? ""} onChange={(e) => setForm({ ...form, sku_interno: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Unidade</Label>
              <Input value={form.unidade ?? ""} onChange={(e) => setForm({ ...form, unidade: e.target.value })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Nome</Label>
              <Input value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Família</Label>
              <Select value={form.familia_id} onValueChange={(v) => setForm({ ...form, familia_id: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {familias.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Preço atual (R$)</Label>
              <Input type="number" step="0.01" value={form.preco_atual ?? 0} onChange={(e) => setForm({ ...form, preco_atual: parseFloat(e.target.value) })} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Observações</Label>
              <Textarea value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} className="bg-primary text-primary-foreground hover:bg-primary/90">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
