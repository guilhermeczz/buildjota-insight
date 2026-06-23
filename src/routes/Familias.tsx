import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Power } from "lucide-react";
import { familias as initial, type Familia } from "@/lib/mock-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function Familias() {
  const [list, setList] = useState<Familia[]>(initial);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Familia | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "" });

  const filtered = list.filter((f) => {
    if (q && !f.nome.toLowerCase().includes(q.toLowerCase())) return false;
    if (statusFilter === "ativos" && !f.ativo) return false;
    if (statusFilter === "inativos" && f.ativo) return false;
    return true;
  });

  function openNew() {
    setEditing(null);
    setForm({ nome: "", descricao: "" });
    setOpen(true);
  }
  function openEdit(f: Familia) {
    setEditing(f);
    setForm({ nome: f.nome, descricao: f.descricao });
    setOpen(true);
  }
  function save() {
    if (!form.nome.trim()) {
      toast.error("Informe o nome da família");
      return;
    }
    if (editing) {
      setList((l) => l.map((x) => (x.id === editing.id ? { ...x, ...form } : x)));
      toast.success("Família atualizada");
    } else {
      setList((l) => [
        ...l,
        { id: `f${Date.now()}`, nome: form.nome, descricao: form.descricao, ativo: true, created_at: new Date().toISOString() },
      ]);
      toast.success("Família cadastrada");
    }
    setOpen(false);
  }
  function toggleAtivo(f: Familia) {
    setList((l) => l.map((x) => (x.id === f.id ? { ...x, ativo: !x.ativo } : x)));
    toast.success(`Família ${f.ativo ? "inativada" : "ativada"}`);
  }

  return (
    <>
      <PageHeader
        title="Famílias"
        description="Organize os produtos monitorados por família. Família inicial do MVP: OTTO - Vedacit e Vedalit."
        actions={
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1" /> Nova família
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Pesquisar família..."
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                <SelectItem value="ativos">Apenas ativos</SelectItem>
                <SelectItem value="inativos">Apenas inativos</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-10 text-muted-foreground">
                    Nenhuma família encontrada
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="font-medium">{f.nome}</TableCell>
                  <TableCell className="text-muted-foreground max-w-md">{f.descricao}</TableCell>
                  <TableCell>
                    {f.ativo ? (
                      <Badge className="bg-success text-success-foreground">Ativo</Badge>
                    ) : (
                      <Badge variant="secondary">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(f)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleAtivo(f)}>
                      <Power className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar família" : "Nova família"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
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
