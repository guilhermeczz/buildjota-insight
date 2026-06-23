import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Power, Lock } from "lucide-react";
import { fornecedores as initial, type Fornecedor } from "@/lib/mock-data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function Fornecedores() {
  const [list, setList] = useState<Fornecedor[]>(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Fornecedor | null>(null);
  const [form, setForm] = useState<Partial<Fornecedor>>({});

  function openNew() {
    setEditing(null);
    setForm({ nome: "", site_url: "", login_url: "", tipo_consulta: "SKU", observacoes: "" });
    setOpen(true);
  }
  function openEdit(f: Fornecedor) {
    setEditing(f);
    setForm(f);
    setOpen(true);
  }
  function save() {
    if (!form.nome) { toast.error("Informe o nome"); return; }
    if (editing) {
      setList((l) => l.map((x) => (x.id === editing.id ? { ...x, ...(form as Fornecedor) } : x)));
      toast.success("Fornecedor atualizado");
    } else {
      setList((l) => [...l, { ...(form as Fornecedor), id: `for${Date.now()}`, ativo: true }]);
      toast.success("Fornecedor cadastrado");
    }
    setOpen(false);
  }

  return (
    <>
      <PageHeader
        title="Fornecedores / Concorrentes"
        description="Cadastro dos fornecedores e concorrentes que serão monitorados pelo robô externo."
        actions={
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-1" /> Novo fornecedor
          </Button>
        }
      />

      <Card className="mb-4 border-primary/40 bg-primary/5">
        <CardContent className="p-4 flex gap-3 items-start text-sm">
          <Lock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <strong>Credenciais de fornecedores não são armazenadas neste painel.</strong>{" "}
            Login e senha serão configurados como variáveis de ambiente / GitHub Secrets,
            usadas exclusivamente pelo robô externo (Node.js + Playwright).
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>URL de login</TableHead>
                  <TableHead>Tipo de consulta</TableHead>
                  <TableHead>Observações</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.nome}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.site_url}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.login_url}</TableCell>
                    <TableCell><Badge variant="outline">{f.tipo_consulta}</Badge></TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-xs">{f.observacoes}</TableCell>
                    <TableCell>{f.ativo ? <Badge className="bg-success text-success-foreground">Ativo</Badge> : <Badge variant="secondary">Inativo</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(f)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setList((l) => l.map((x) => x.id === f.id ? { ...x, ativo: !x.ativo } : x))}><Power className="h-4 w-4" /></Button>
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
            <DialogTitle>{editing ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5"><Label>Nome</Label><Input value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Site / base URL</Label><Input value={form.site_url ?? ""} onChange={(e) => setForm({ ...form, site_url: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>URL de login</Label><Input value={form.login_url ?? ""} onChange={(e) => setForm({ ...form, login_url: e.target.value })} /></div>
            <div className="space-y-1.5">
              <Label>Tipo de consulta</Label>
              <Select value={form.tipo_consulta} onValueChange={(v) => setForm({ ...form, tipo_consulta: v as Fornecedor["tipo_consulta"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SKU">SKU</SelectItem>
                  <SelectItem value="URL">URL direta</SelectItem>
                  <SelectItem value="BUSCA">Busca no site</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Observações</Label><Textarea value={form.observacoes ?? ""} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
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
