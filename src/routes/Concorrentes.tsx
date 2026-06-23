import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Pencil, Power, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type Concorrente = {
  id: string;
  nome: string;
  site_url: string;
  login_url: string;
  tipo_consulta: "SKU" | "URL" | "BUSCA";
  observacoes: string;
  ativo: boolean;
};

export default function Concorrentes() {
  const [list, setList] = useState<Concorrente[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Concorrente | null>(null);
  const [form, setForm] = useState<Partial<Concorrente>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase
      .from("concorrentes")
      .select("id,nome,site_url,login_url,tipo_consulta,observacoes,ativo")
      .order("nome")
      .then(({ data }) => {
        if (!mounted) return;
        setList((data ?? []) as Concorrente[]);
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function openNew() {
    setEditing(null);
    setForm({ nome: "", site_url: "", login_url: "", observacoes: "" });
    setOpen(true);
  }

  function openEdit(f: Concorrente) {
    setEditing(f);
    setForm(f);
    setOpen(true);
  }

  function save() {
    if (!form.nome || !form.tipo_consulta) {
      toast.error("Informe o nome e o tipo de consulta");
      return;
    }

    if (editing) {
      const payload = form as Concorrente;
      supabase
        .from("concorrentes")
        .update(payload)
        .eq("id", editing.id)
        .then(({ error }) => {
          if (error) {
            toast.error("Não foi possível atualizar o concorrente");
            return;
          }
          setList((l) => l.map((x) => (x.id === editing.id ? { ...x, ...payload } : x)));
          toast.success("Concorrente atualizado");
        });
    } else {
      supabase
        .from("concorrentes")
        .insert({ ...(form as Concorrente), ativo: true })
        .select("id,nome,site_url,login_url,tipo_consulta,observacoes,ativo")
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            toast.error("Não foi possível cadastrar o concorrente");
            return;
          }
          setList((l) => [...l, data as Concorrente]);
          toast.success("Concorrente cadastrado");
        });
    }
    setOpen(false);
  }

  function toggleAtivo(f: Concorrente) {
    const ativo = !f.ativo;
    supabase
      .from("concorrentes")
      .update({ ativo })
      .eq("id", f.id)
      .then(({ error }) => {
        if (error) {
          toast.error("Não foi possível alterar o status");
          return;
        }
        setList((l) => l.map((x) => (x.id === f.id ? { ...x, ativo } : x)));
      });
  }

  return (
    <>
      <PageHeader
        title="Concorrentes"
        description="Cadastro dos concorrentes que serão monitorados pelo robô externo."
        actions={
          <Button
            onClick={openNew}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-1" /> Novo concorrente
          </Button>
        }
      />

      <Card className="mb-4 border-primary/40 bg-primary/5">
        <CardContent className="p-4 flex gap-3 items-start text-sm">
          <Lock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            <strong>Credenciais de concorrentes não são armazenadas neste painel.</strong> Login e
            senha serão configurados como variáveis de ambiente, usadas exclusivamente pelo robô
            externo.
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
                {!loading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      Nenhum concorrente cadastrado.
                    </TableCell>
                  </TableRow>
                )}
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                      Carregando concorrentes...
                    </TableCell>
                  </TableRow>
                )}
                {list.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.nome}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.site_url}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{f.login_url}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{f.tipo_consulta}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-xs">
                      {f.observacoes}
                    </TableCell>
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
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar concorrente" : "Novo concorrente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={form.nome ?? ""}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Site / base URL</Label>
              <Input
                value={form.site_url ?? ""}
                onChange={(e) => setForm({ ...form, site_url: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>URL de login</Label>
              <Input
                value={form.login_url ?? ""}
                onChange={(e) => setForm({ ...form, login_url: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tipo de consulta</Label>
              <Select
                value={form.tipo_consulta || undefined}
                onValueChange={(v) =>
                  setForm({ ...form, tipo_consulta: v as Concorrente["tipo_consulta"] })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SKU">SKU</SelectItem>
                  <SelectItem value="URL">URL direta</SelectItem>
                  <SelectItem value="BUSCA">Busca no site</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea
                value={form.observacoes ?? ""}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
