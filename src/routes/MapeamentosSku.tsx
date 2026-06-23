import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { formatBRL, formatDateTime } from "@/lib/format";
import { compareProductNames, sortByProductName } from "@/lib/product-sort";
import { supabase } from "@/lib/supabase";
import { ExternalLink, History, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

type ProdutoOption = {
  id: string;
  sku_interno: string;
  nome: string;
  familia_id: string | null;
  preco_atual: number;
  familias?: { nome: string } | null;
};

type ConcorrenteOption = {
  id: string;
  nome: string;
  ativo: boolean;
};

type Mapeamento = {
  id: string;
  produto_id: string;
  concorrente_id: string;
  sku_concorrente: string;
  url_produto: string;
  unidade_equivalente: string;
  seletor_preco: string | null;
  observacoes: string;
  ativo: boolean;
  ultimo_preco: number | null;
  ultima_atualizacao: string | null;
  status_coleta: "sucesso" | "erro" | "pendente";
  produtos?: ProdutoOption | null;
  concorrentes?: { nome: string } | null;
};

type MapeamentoForm = {
  produto_id: string;
  concorrente_id: string;
  sku_concorrente: string;
  url_produto: string;
  unidade_equivalente: string;
  seletor_preco: string;
  observacoes: string;
};

const emptyForm: MapeamentoForm = {
  produto_id: "",
  concorrente_id: "",
  sku_concorrente: "",
  url_produto: "",
  unidade_equivalente: "",
  seletor_preco: "",
  observacoes: "",
};

function normalizeMapeamento(row: Mapeamento): Mapeamento {
  return {
    ...row,
    ultimo_preco: row.ultimo_preco === null ? null : Number(row.ultimo_preco),
  };
}

export default function MapeamentosSku() {
  const [list, setList] = useState<Mapeamento[]>([]);
  const [produtos, setProdutos] = useState<ProdutoOption[]>([]);
  const [concorrentes, setConcorrentes] = useState<ConcorrenteOption[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Mapeamento | null>(null);
  const [deleting, setDeleting] = useState<Mapeamento | null>(null);
  const [form, setForm] = useState<MapeamentoForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refreshData() {
    const [produtosResult, concorrentesResult, mapeamentosResult] = await Promise.all([
      supabase
        .from("produtos")
        .select("id,sku_interno,nome,familia_id,preco_atual,familias(nome)")
        .eq("ativo", true)
        .order("nome"),
      supabase.from("concorrentes").select("id,nome,ativo").eq("ativo", true).order("nome"),
      supabase
        .from("mapeamentos_sku")
        .select(
          "id,produto_id,concorrente_id,sku_concorrente,url_produto,unidade_equivalente,seletor_preco,observacoes,ativo,ultimo_preco,ultima_atualizacao,status_coleta,produtos(id,sku_interno,nome,familia_id,preco_atual,familias(nome)),concorrentes(nome)",
        )
        .order("created_at", { ascending: false }),
    ]);

    if (produtosResult.error || concorrentesResult.error || mapeamentosResult.error) {
      toast.error("Não foi possível carregar os mapeamentos");
      setLoading(false);
      return;
    }

    setProdutos(
      sortByProductName((produtosResult.data ?? []) as ProdutoOption[], (produto) => produto.nome),
    );
    setConcorrentes((concorrentesResult.data ?? []) as ConcorrenteOption[]);
    setList(
      ((mapeamentosResult.data ?? []) as Mapeamento[]).map(normalizeMapeamento).sort((a, b) => {
        const productCompare = compareProductNames(a.produtos?.nome ?? "", b.produtos?.nome ?? "");
        if (productCompare !== 0) return productCompare;
        return (a.concorrentes?.nome ?? "").localeCompare(b.concorrentes?.nome ?? "", "pt-BR");
      }),
    );
    setLoading(false);
  }

  useEffect(() => {
    void refreshData();
  }, []);

  const filtered = useMemo(
    () =>
      list.filter((mapeamento) => {
        if (!q) return true;
        const needle = q.toLowerCase();
        const produto = mapeamento.produtos;
        const concorrente = mapeamento.concorrentes;
        return (
          produto?.nome.toLowerCase().includes(needle) ||
          produto?.sku_interno.toLowerCase().includes(needle) ||
          mapeamento.sku_concorrente.toLowerCase().includes(needle) ||
          concorrente?.nome.toLowerCase().includes(needle)
        );
      }),
    [list, q],
  );

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setOpen(true);
  }

  function openEdit(mapeamento: Mapeamento) {
    setEditing(mapeamento);
    setForm({
      produto_id: mapeamento.produto_id,
      concorrente_id: mapeamento.concorrente_id,
      sku_concorrente: mapeamento.sku_concorrente,
      url_produto: mapeamento.url_produto,
      unidade_equivalente: mapeamento.unidade_equivalente,
      seletor_preco: mapeamento.seletor_preco ?? "",
      observacoes: mapeamento.observacoes,
    });
    setOpen(true);
  }

  async function save() {
    if (!form.produto_id || !form.concorrente_id || !form.sku_concorrente.trim()) {
      toast.error("Preencha produto, concorrente e SKU do concorrente");
      return;
    }

    const payload = {
      produto_id: form.produto_id,
      concorrente_id: form.concorrente_id,
      sku_concorrente: form.sku_concorrente.trim(),
      url_produto: form.url_produto.trim(),
      unidade_equivalente: form.unidade_equivalente.trim(),
      seletor_preco: form.seletor_preco.trim() || null,
      observacoes: form.observacoes.trim(),
    };

    setSaving(true);

    if (editing) {
      const { error } = await supabase.from("mapeamentos_sku").update(payload).eq("id", editing.id);

      setSaving(false);

      if (error) {
        toast.error(
          error.code === "23505"
            ? "Esse mapeamento já existe"
            : "Não foi possível atualizar o mapeamento",
        );
        return;
      }

      await refreshData();
      toast.success("Mapeamento atualizado");
      setOpen(false);
      return;
    }

    const { error } = await supabase.from("mapeamentos_sku").insert({
      ...payload,
      ativo: true,
      status_coleta: "pendente",
    });

    setSaving(false);

    if (error) {
      toast.error(
        error.code === "23505"
          ? "Esse mapeamento já existe"
          : "Não foi possível criar o mapeamento",
      );
      return;
    }

    await refreshData();
    toast.success("Mapeamento criado");
    setOpen(false);
  }

  async function toggleAtivo(mapeamento: Mapeamento) {
    const ativo = !mapeamento.ativo;
    const { error } = await supabase
      .from("mapeamentos_sku")
      .update({ ativo })
      .eq("id", mapeamento.id);

    if (error) {
      toast.error("Não foi possível alterar o status do mapeamento");
      return;
    }

    setList((current) =>
      current.map((item) => (item.id === mapeamento.id ? { ...item, ativo } : item)),
    );
  }

  async function deleteMapeamento() {
    if (!deleting) return;

    const { error } = await supabase.from("mapeamentos_sku").delete().eq("id", deleting.id);

    if (error) {
      toast.error("Não foi possível excluir o mapeamento");
      return;
    }

    setList((current) => current.filter((item) => item.id !== deleting.id));
    setDeleting(null);
    toast.success("Mapeamento excluído");
  }

  return (
    <>
      <PageHeader
        title="Mapeamento de SKUs"
        description="Conecte o SKU da ConstruJota ao SKU equivalente em cada concorrente."
        actions={
          <Button
            onClick={openNew}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1 h-4 w-4" /> Novo mapeamento
          </Button>
        }
      />

      <Card className="mb-4 bg-secondary text-secondary-foreground">
        <CardContent className="p-4 text-sm">
          A comparação depende deste mapeamento manual. Cada linha conecta um produto interno a um
          produto equivalente de um concorrente.
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              placeholder="Pesquisar..."
              className="pl-9"
            />
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto CJ</TableHead>
                  <TableHead>SKU CJ</TableHead>
                  <TableHead>Concorrente</TableHead>
                  <TableHead>SKU Conc.</TableHead>
                  <TableHead>Família</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Último preço</TableHead>
                  <TableHead>Última atualização</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      Carregando mapeamentos...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      Nenhum mapeamento encontrado
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((mapeamento) => {
                  const produto = mapeamento.produtos;
                  const concorrente = mapeamento.concorrentes;
                  return (
                    <TableRow key={mapeamento.id}>
                      <TableCell className="font-medium">{produto?.nome ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {produto?.sku_interno ?? "-"}
                      </TableCell>
                      <TableCell>{concorrente?.nome ?? "-"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {mapeamento.sku_concorrente}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {produto?.familias?.nome ?? "Sem família"}
                      </TableCell>
                      <TableCell>
                        {mapeamento.url_produto ? (
                          <a
                            href={mapeamento.url_produto}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            abrir <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {mapeamento.ultimo_preco ? formatBRL(mapeamento.ultimo_preco) : "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {mapeamento.ultima_atualizacao
                          ? formatDateTime(mapeamento.ultima_atualizacao)
                          : "-"}
                      </TableCell>
                      <TableCell>
                        {mapeamento.status_coleta === "sucesso" && (
                          <Badge className="bg-success text-success-foreground">Sucesso</Badge>
                        )}
                        {mapeamento.status_coleta === "erro" && (
                          <Badge variant="destructive">Erro</Badge>
                        )}
                        {mapeamento.status_coleta === "pendente" && (
                          <Badge variant="secondary">Pendente</Badge>
                        )}
                        {!mapeamento.ativo && <Badge variant="outline">Inativo</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/historico" title="Histórico">
                            <History className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(mapeamento)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toggleAtivo(mapeamento)}>
                          <Power className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeleting(mapeamento)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
            <DialogDescription>
              Defina a equivalência entre o produto interno e o produto do concorrente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Produto ConstruJota</Label>
              <Select
                value={form.produto_id || undefined}
                onValueChange={(value) => setForm({ ...form, produto_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {produtos.map((produto) => (
                    <SelectItem key={produto.id} value={produto.id}>
                      {produto.sku_interno} - {produto.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Concorrente</Label>
              <Select
                value={form.concorrente_id || undefined}
                onValueChange={(value) => setForm({ ...form, concorrente_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {concorrentes.map((concorrente) => (
                    <SelectItem key={concorrente.id} value={concorrente.id}>
                      {concorrente.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>SKU no concorrente</Label>
              <Input
                value={form.sku_concorrente}
                onChange={(event) => setForm({ ...form, sku_concorrente: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Unidade equivalente</Label>
              <Input
                value={form.unidade_equivalente}
                onChange={(event) => setForm({ ...form, unidade_equivalente: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>URL do produto</Label>
              <Input
                value={form.url_produto}
                onChange={(event) => setForm({ ...form, url_produto: event.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Seletor de preço</Label>
              <Input
                value={form.seletor_preco}
                onChange={(event) => setForm({ ...form, seletor_preco: event.target.value })}
                placeholder="ex: .product-price__value"
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
              {saving ? "Salvando..." : "Salvar mapeamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir mapeamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa ação remove o mapeamento de SKU e também apaga o histórico de preços vinculado a
              ele.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteMapeamento}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
