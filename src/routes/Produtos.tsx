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
import { formatBRL } from "@/lib/format";
import { compareProductNames, sortByProductName } from "@/lib/product-sort";
import { supabase } from "@/lib/supabase";
import { Pencil, Plus, Power, Search } from "lucide-react";
import { toast } from "sonner";

type FamiliaOption = {
  id: string;
  nome: string;
  ativo: boolean;
};

type Produto = {
  id: string;
  sku_interno: string;
  nome: string;
  familia_id: string | null;
  unidade: string;
  preco_atual: number;
  observacoes: string;
  ativo: boolean;
  familias?: { nome: string } | null;
};

type ProdutoForm = {
  sku_interno: string;
  nome: string;
  familia_id: string;
  unidade: string;
  preco_atual: string;
  observacoes: string;
};

const emptyForm: ProdutoForm = {
  sku_interno: "",
  nome: "",
  familia_id: "",
  unidade: "",
  preco_atual: "",
  observacoes: "",
};

function normalizeProduto(row: Produto): Produto {
  return {
    ...row,
    preco_atual: Number(row.preco_atual ?? 0),
  };
}

export default function Produtos() {
  const [list, setList] = useState<Produto[]>([]);
  const [familias, setFamilias] = useState<FamiliaOption[]>([]);
  const [q, setQ] = useState("");
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Produto | null>(null);
  const [form, setForm] = useState<ProdutoForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refreshData() {
    const [familiasResult, produtosResult] = await Promise.all([
      supabase.from("familias").select("id,nome,ativo").order("nome", { ascending: true }),
      supabase
        .from("produtos")
        .select(
          "id,sku_interno,nome,familia_id,unidade,preco_atual,observacoes,ativo,familias(nome)",
        )
        .order("nome", { ascending: true }),
    ]);

    if (familiasResult.error || produtosResult.error) {
      toast.error("Não foi possível carregar os produtos");
      setLoading(false);
      return;
    }

    setFamilias((familiasResult.data ?? []) as FamiliaOption[]);
    setList(
      sortByProductName(
        ((produtosResult.data ?? []) as Produto[]).map(normalizeProduto),
        (produto) => produto.nome,
      ),
    );
    setLoading(false);
  }

  useEffect(() => {
    void refreshData();
  }, []);

  const activeFamilias = useMemo(() => familias.filter((familia) => familia.ativo), [familias]);

  const filtered = useMemo(
    () =>
      list.filter((produto) => {
        const term = q.toLowerCase();
        if (
          term &&
          !produto.nome.toLowerCase().includes(term) &&
          !produto.sku_interno.toLowerCase().includes(term)
        ) {
          return false;
        }
        if (familiaFilter !== "todas" && produto.familia_id !== familiaFilter) return false;
        if (statusFilter === "ativos" && !produto.ativo) return false;
        if (statusFilter === "inativos" && produto.ativo) return false;
        return true;
      }),
    [familiaFilter, list, q, statusFilter],
  );

  function getFamiliaNome(id: string | null) {
    if (!id) return "Sem família";
    return familias.find((familia) => familia.id === id)?.nome ?? "Sem família";
  }

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(produto: Produto) {
    setEditing(produto);
    setForm({
      sku_interno: produto.sku_interno,
      nome: produto.nome,
      familia_id: produto.familia_id ?? "",
      unidade: produto.unidade,
      preco_atual: String(produto.preco_atual),
      observacoes: produto.observacoes,
    });
    setOpen(true);
  }

  async function save() {
    const sku = form.sku_interno.trim();
    const nome = form.nome.trim();
    const precoText = form.preco_atual.trim();
    const preco = Number(precoText.replace(",", "."));

    if (!sku || !nome || !form.familia_id) {
      toast.error("Informe SKU, nome e família");
      return;
    }

    if (!precoText || Number.isNaN(preco) || preco < 0) {
      toast.error("Informe um preço válido");
      return;
    }

    const payload = {
      sku_interno: sku,
      nome,
      familia_id: form.familia_id,
      unidade: form.unidade.trim(),
      preco_atual: preco,
      observacoes: form.observacoes.trim(),
    };

    setSaving(true);

    if (editing) {
      const { data, error } = await supabase
        .from("produtos")
        .update(payload)
        .eq("id", editing.id)
        .select(
          "id,sku_interno,nome,familia_id,unidade,preco_atual,observacoes,ativo,familias(nome)",
        )
        .single();

      setSaving(false);

      if (error || !data) {
        toast.error(
          error?.code === "23505"
            ? "Já existe um produto com esse SKU"
            : "Não foi possível atualizar o produto",
        );
        return;
      }

      const produto = normalizeProduto(data as Produto);
      setList((current) =>
        current
          .map((item) => (item.id === produto.id ? produto : item))
          .sort((a, b) => compareProductNames(a.nome, b.nome)),
      );
      toast.success("Produto atualizado");
      setOpen(false);
      return;
    }

    const { data, error } = await supabase
      .from("produtos")
      .insert({ ...payload, ativo: true })
      .select("id,sku_interno,nome,familia_id,unidade,preco_atual,observacoes,ativo,familias(nome)")
      .single();

    setSaving(false);

    if (error || !data) {
      toast.error(
        error?.code === "23505"
          ? "Já existe um produto com esse SKU"
          : "Não foi possível cadastrar o produto",
      );
      return;
    }

    setList((current) =>
      [...current, normalizeProduto(data as Produto)].sort((a, b) =>
        compareProductNames(a.nome, b.nome),
      ),
    );
    toast.success("Produto cadastrado");
    setOpen(false);
  }

  async function toggleAtivo(produto: Produto) {
    const ativo = !produto.ativo;
    const { error } = await supabase.from("produtos").update({ ativo }).eq("id", produto.id);

    if (error) {
      toast.error("Não foi possível alterar o status do produto");
      return;
    }

    setList((current) =>
      current.map((item) => (item.id === produto.id ? { ...item, ativo } : item)),
    );
  }

  return (
    <>
      <PageHeader
        title="Produtos ConstruJota"
        description="Catálogo interno de produtos que serão monitorados."
        actions={
          <Button
            onClick={openNew}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" /> Novo produto
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Pesquisar por SKU ou nome..."
                className="pl-9"
              />
            </div>
            <Select value={familiaFilter} onValueChange={setFamiliaFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Família" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas as famílias</SelectItem>
                {familias.map((familia) => (
                  <SelectItem key={familia.id} value={familia.id}>
                    {familia.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
                {loading && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Carregando produtos...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                      Nenhum produto encontrado
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((produto) => (
                  <TableRow key={produto.id}>
                    <TableCell className="font-mono text-xs">{produto.sku_interno}</TableCell>
                    <TableCell className="font-medium">{produto.nome}</TableCell>
                    <TableCell>{getFamiliaNome(produto.familia_id)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {produto.unidade || "-"}
                    </TableCell>
                    <TableCell>{formatBRL(produto.preco_atual)}</TableCell>
                    <TableCell>
                      {produto.ativo ? (
                        <Badge className="bg-success text-success-foreground">Ativo</Badge>
                      ) : (
                        <Badge variant="secondary">Inativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(produto)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleAtivo(produto)}>
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
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>SKU interno</Label>
              <Input
                value={form.sku_interno}
                onChange={(event) => setForm({ ...form, sku_interno: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Unidade</Label>
              <Input
                value={form.unidade}
                onChange={(event) => setForm({ ...form, unidade: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Nome</Label>
              <Input
                value={form.nome}
                onChange={(event) => setForm({ ...form, nome: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Família</Label>
              <select
                value={form.familia_id}
                onChange={(event) => setForm({ ...form, familia_id: event.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="" disabled>
                  Selecione uma família
                </option>
                {activeFamilias.map((familia) => (
                  <option key={familia.id} value={familia.id}>
                    {familia.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Preço atual (R$)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={form.preco_atual}
                onChange={(event) => setForm({ ...form, preco_atual: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={form.observacoes}
                onChange={(event) => setForm({ ...form, observacoes: event.target.value })}
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
