import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/lib/supabase";
import { Pencil, Plus, Power, Search } from "lucide-react";
import { toast } from "sonner";

type Familia = {
  id: string;
  nome: string;
  descricao: string;
  ativo: boolean;
  created_at: string;
};

type FamiliaForm = {
  nome: string;
  descricao: string;
};

const emptyForm: FamiliaForm = {
  nome: "",
  descricao: "",
};

export default function Familias() {
  const [list, setList] = useState<Familia[]>([]);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Familia | null>(null);
  const [form, setForm] = useState<FamiliaForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refreshFamilias() {
    const { data, error } = await supabase
      .from("familias")
      .select("id,nome,descricao,ativo,created_at")
      .order("nome", { ascending: true });

    if (error) {
      toast.error("Nao foi possivel carregar as familias");
      setLoading(false);
      return;
    }

    setList((data ?? []) as Familia[]);
    setLoading(false);
  }

  useEffect(() => {
    void refreshFamilias();
  }, []);

  const filtered = useMemo(
    () =>
      list.filter((f) => {
        if (q && !f.nome.toLowerCase().includes(q.toLowerCase())) return false;
        if (statusFilter === "ativos" && !f.ativo) return false;
        if (statusFilter === "inativos" && f.ativo) return false;
        return true;
      }),
    [list, q, statusFilter],
  );

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(familia: Familia) {
    setEditing(familia);
    setForm({ nome: familia.nome, descricao: familia.descricao });
    setOpen(true);
  }

  async function save() {
    const nome = form.nome.trim();
    const descricao = form.descricao.trim();

    if (!nome) {
      toast.error("Informe o nome da familia");
      return;
    }

    setSaving(true);

    if (editing) {
      const { error } = await supabase
        .from("familias")
        .update({ nome, descricao })
        .eq("id", editing.id);

      setSaving(false);

      if (error) {
        toast.error(
          error.code === "23505"
            ? "Ja existe uma familia com esse nome"
            : "Nao foi possivel atualizar a familia",
        );
        return;
      }

      setList((current) =>
        current
          .map((item) => (item.id === editing.id ? { ...item, nome, descricao } : item))
          .sort((a, b) => a.nome.localeCompare(b.nome)),
      );
      toast.success("Familia atualizada");
      setOpen(false);
      return;
    }

    const { data, error } = await supabase
      .from("familias")
      .insert({ nome, descricao, ativo: true })
      .select("id,nome,descricao,ativo,created_at")
      .single();

    setSaving(false);

    if (error || !data) {
      toast.error(
        error?.code === "23505"
          ? "Ja existe uma familia com esse nome"
          : "Nao foi possivel cadastrar a familia",
      );
      return;
    }

    setList((current) =>
      [...current, data as Familia].sort((a, b) => a.nome.localeCompare(b.nome)),
    );
    toast.success("Familia cadastrada");
    setOpen(false);
  }

  async function toggleAtivo(familia: Familia) {
    const ativo = !familia.ativo;
    const { error } = await supabase.from("familias").update({ ativo }).eq("id", familia.id);

    if (error) {
      toast.error("Nao foi possivel alterar o status da familia");
      return;
    }

    setList((current) =>
      current.map((item) => (item.id === familia.id ? { ...item, ativo } : item)),
    );
    toast.success(`Familia ${ativo ? "ativada" : "inativada"}`);
  }

  return (
    <>
      <PageHeader
        title="Familias"
        description="Organize os produtos monitorados por familia."
        actions={
          <Button
            onClick={openNew}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" /> Nova familia
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Pesquisar familia..."
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
                <TableHead>Descricao</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Carregando familias...
                  </TableCell>
                </TableRow>
              )}
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    Nenhuma familia encontrada
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((familia) => (
                <TableRow key={familia.id}>
                  <TableCell className="font-medium">{familia.nome}</TableCell>
                  <TableCell className="max-w-md text-muted-foreground">
                    {familia.descricao || "-"}
                  </TableCell>
                  <TableCell>
                    {familia.ativo ? (
                      <Badge className="bg-success text-success-foreground">Ativo</Badge>
                    ) : (
                      <Badge variant="secondary">Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(familia)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleAtivo(familia)}>
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
            <DialogTitle>{editing ? "Editar familia" : "Nova familia"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(event) => setForm({ ...form, nome: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descricao</Label>
              <Textarea
                value={form.descricao}
                onChange={(event) => setForm({ ...form, descricao: event.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
