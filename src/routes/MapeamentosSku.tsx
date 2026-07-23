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
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { apiClient } from "@/lib/api-client";
import {
  ChevronDown,
  ExternalLink,
  History,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

type ProdutoOption = {
  id: string;
  sku_interno: string;
  nome: string;
  familia_id: string | null;
  preco_atual: number;
  familias?: { nome: string } | null;
};

type FamiliaOption = {
  id: string;
  nome: string;
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
  selection_mode: "all" | "family" | "products";
  produto_id: string;
  produto_ids: string[];
  familia_id: string;
  concorrente_id: string;
  concorrente_ids: string[];
  detalhes_por_concorrente: Record<string, MapeamentoDetails>;
  sku_concorrente: string;
  url_produto: string;
  unidade_equivalente: string;
  seletor_preco: string;
  observacoes: string;
};

type MapeamentoDetails = {
  sku_concorrente: string;
  url_produto: string;
  unidade_equivalente: string;
  seletor_preco: string;
  observacoes: string;
};

const emptyDetails: MapeamentoDetails = {
  sku_concorrente: "",
  url_produto: "",
  unidade_equivalente: "",
  seletor_preco: "",
  observacoes: "",
};

const emptyForm: MapeamentoForm = {
  selection_mode: "products",
  produto_id: "",
  produto_ids: [],
  familia_id: "",
  concorrente_id: "",
  concorrente_ids: [],
  detalhes_por_concorrente: {},
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
  const [familias, setFamilias] = useState<FamiliaOption[]>([]);
  const [concorrentes, setConcorrentes] = useState<ConcorrenteOption[]>([]);
  const [q, setQ] = useState("");
  const [familiaFilter, setFamiliaFilter] = useState("all");
  const [produtoFilter, setProdutoFilter] = useState("all");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Mapeamento | null>(null);
  const [deleting, setDeleting] = useState<Mapeamento | null>(null);
  const [form, setForm] = useState<MapeamentoForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingLoading, setDeletingLoading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function refreshData() {
    const [produtosResult, familiasResult, concorrentesResult, mapeamentosResult] =
      await Promise.all([
        apiClient
          .from("produtos")
          .select("id,sku_interno,nome,familia_id,preco_atual,familias(nome)")
          .eq("ativo", true)
          .order("nome"),
        apiClient.from("familias").select("id,nome").eq("ativo", true).order("nome"),
        apiClient.from("concorrentes").select("id,nome,ativo").eq("ativo", true).order("nome"),
        apiClient
          .from("mapeamentos_sku")
          .select(
            "id,produto_id,concorrente_id,sku_concorrente,url_produto,unidade_equivalente,seletor_preco,observacoes,ativo,ultimo_preco,ultima_atualizacao,status_coleta,produtos(id,sku_interno,nome,familia_id,preco_atual,familias(nome)),concorrentes(nome)",
          )
          .order("created_at", { ascending: false }),
      ]);

    if (
      produtosResult.error ||
      familiasResult.error ||
      concorrentesResult.error ||
      mapeamentosResult.error
    ) {
      toast.error("Não foi possível carregar os mapeamentos");
      setLoading(false);
      return;
    }

    setProdutos(
      sortByProductName((produtosResult.data ?? []) as ProdutoOption[], (produto) => produto.nome),
    );
    setFamilias((familiasResult.data ?? []) as FamiliaOption[]);
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
        const produto = mapeamento.produtos;

        if (familiaFilter !== "all" && produto?.familia_id !== familiaFilter) return false;
        if (produtoFilter !== "all" && mapeamento.produto_id !== produtoFilter) return false;
        if (!q) return true;

        const needle = q.toLowerCase();
        const concorrente = mapeamento.concorrentes;
        return (
          produto?.nome.toLowerCase().includes(needle) ||
          produto?.sku_interno.toLowerCase().includes(needle) ||
          mapeamento.sku_concorrente.toLowerCase().includes(needle) ||
          concorrente?.nome.toLowerCase().includes(needle)
        );
      }),
    [familiaFilter, list, produtoFilter, q],
  );

  const produtosDoFiltro = useMemo(() => {
    if (familiaFilter === "all") return produtos;
    return produtos.filter((produto) => produto.familia_id === familiaFilter);
  }, [familiaFilter, produtos]);

  function changeFamiliaFilter(value: string) {
    setFamiliaFilter(value);
    setProdutoFilter("all");
  }

  const produtosPorFamilia = useMemo(() => {
    const groups = new Map<string, { id: string; nome: string; produtos: ProdutoOption[] }>();

    for (const familia of familias) {
      groups.set(familia.id, { id: familia.id, nome: familia.nome, produtos: [] });
    }

    for (const produto of produtos) {
      const familiaId = produto.familia_id ?? "sem-familia";
      const familiaNome = produto.familias?.nome ?? "Sem famÃ­lia";
      const group = groups.get(familiaId) ?? { id: familiaId, nome: familiaNome, produtos: [] };
      group.produtos.push(produto);
      groups.set(familiaId, group);
    }

    return Array.from(groups.values())
      .filter((group) => group.produtos.length > 0)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [familias, produtos]);

  const selectedProdutoIds = useMemo(() => {
    if (editing) return form.produto_id ? [form.produto_id] : [];
    if (form.selection_mode === "all") return produtos.map((produto) => produto.id);
    if (form.selection_mode === "family") {
      return produtos
        .filter((produto) => produto.familia_id === form.familia_id)
        .map((produto) => produto.id);
    }

    return form.produto_ids;
  }, [editing, form.familia_id, form.produto_id, form.produto_ids, form.selection_mode, produtos]);

  const selectedProdutos = useMemo(
    () =>
      selectedProdutoIds.map((id) => produtos.find((produto) => produto.id === id)).filter(Boolean),
    [produtos, selectedProdutoIds],
  ) as ProdutoOption[];

  const selectedConcorrenteIds = useMemo(
    () => (editing ? (form.concorrente_id ? [form.concorrente_id] : []) : form.concorrente_ids),
    [editing, form.concorrente_id, form.concorrente_ids],
  );

  const activeMappingConflicts = useMemo(
    () =>
      list.filter(
        (mapeamento) =>
          mapeamento.ativo &&
          mapeamento.id !== editing?.id &&
          selectedProdutoIds.includes(mapeamento.produto_id) &&
          selectedConcorrenteIds.includes(mapeamento.concorrente_id),
      ),
    [editing?.id, list, selectedConcorrenteIds, selectedProdutoIds],
  );

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setAdvancedOpen(false);
    setOpen(true);
  }

  function openEdit(mapeamento: Mapeamento) {
    setEditing(mapeamento);
    setForm({
      selection_mode: "products",
      produto_id: mapeamento.produto_id,
      produto_ids: [mapeamento.produto_id],
      familia_id: mapeamento.produtos?.familia_id ?? "",
      concorrente_id: mapeamento.concorrente_id,
      concorrente_ids: [mapeamento.concorrente_id],
      detalhes_por_concorrente: {},
      sku_concorrente: mapeamento.sku_concorrente,
      url_produto: mapeamento.url_produto,
      unidade_equivalente: mapeamento.unidade_equivalente,
      seletor_preco: mapeamento.seletor_preco ?? "",
      observacoes: mapeamento.observacoes,
    });
    setAdvancedOpen(!!mapeamento.seletor_preco);
    setOpen(true);
  }

  function toggleConcorrente(concorrenteId: string, checked: boolean | "indeterminate") {
    setForm((current) => ({
      ...current,
      concorrente_ids:
        checked === true
          ? Array.from(new Set([...current.concorrente_ids, concorrenteId]))
          : current.concorrente_ids.filter((id) => id !== concorrenteId),
      detalhes_por_concorrente:
        checked === true
          ? {
              ...current.detalhes_por_concorrente,
              [concorrenteId]: current.detalhes_por_concorrente[concorrenteId] ?? emptyDetails,
            }
          : current.detalhes_por_concorrente,
    }));
  }

  function toggleProduto(produtoId: string, checked: boolean | "indeterminate") {
    setForm((current) => ({
      ...current,
      produto_ids:
        checked === true
          ? Array.from(new Set([...current.produto_ids, produtoId]))
          : current.produto_ids.filter((id) => id !== produtoId),
    }));
  }

  function toggleFamiliaProdutos(produtosDaFamilia: ProdutoOption[], checked: boolean) {
    const ids = produtosDaFamilia.map((produto) => produto.id);

    setForm((current) => ({
      ...current,
      produto_ids: checked
        ? Array.from(new Set([...current.produto_ids, ...ids]))
        : current.produto_ids.filter((id) => !ids.includes(id)),
    }));
  }

  function detailKey(produtoId: string, concorrenteId: string) {
    return `${produtoId}:${concorrenteId}`;
  }

  function updateConcorrenteDetail(key: string, field: keyof MapeamentoDetails, value: string) {
    setForm((current) => ({
      ...current,
      detalhes_por_concorrente: {
        ...current.detalhes_por_concorrente,
        [key]: {
          ...(current.detalhes_por_concorrente[key] ?? emptyDetails),
          [field]: value,
        },
      },
    }));
  }

  async function save() {
    const selectedConcorrentes = editing
      ? form.concorrente_id
        ? [form.concorrente_id]
        : []
      : form.concorrente_ids;
    const selectedProductsForSave = selectedProdutoIds;

    if (selectedProductsForSave.length === 0 || selectedConcorrentes.length === 0) {
      toast.error("Selecione ao menos um produto e um concorrente");
      return;
    }

    if (activeMappingConflicts.length > 0) {
      toast.error(
        "Já existe mapeamento ativo para um ou mais produtos nos concorrentes selecionados",
      );
      return;
    }

    const payloadBase = {
      produto_id: form.produto_id,
      sku_concorrente: form.sku_concorrente.trim(),
      url_produto: form.url_produto.trim(),
      unidade_equivalente: form.unidade_equivalente.trim(),
      seletor_preco: form.seletor_preco.trim() || null,
      observacoes: form.observacoes.trim(),
    };

    if (editing) {
      setSaving(true);
      const { error } = await apiClient
        .from("mapeamentos_sku")
        .update({ ...payloadBase, concorrente_id: selectedConcorrentes[0] })
        .eq("id", editing.id);

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

    const payloads = selectedProductsForSave.flatMap((produtoId) =>
      selectedConcorrentes.map((concorrenteId) => {
        const details =
          form.detalhes_por_concorrente[detailKey(produtoId, concorrenteId)] ?? emptyDetails;

        return {
          produto_id: produtoId,
          concorrente_id: concorrenteId,
          sku_concorrente: details.sku_concorrente.trim(),
          url_produto: details.url_produto.trim(),
          unidade_equivalente: details.unidade_equivalente.trim(),
          seletor_preco: details.seletor_preco.trim() || null,
          observacoes: details.observacoes.trim(),
          ativo: true,
          status_coleta: "pendente",
        };
      }),
    );

    setSaving(true);
    const { error } = await apiClient.from("mapeamentos_sku").insert(payloads);

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
    toast.success(
      payloads.length === 1 ? "Mapeamento criado" : `${payloads.length} mapeamentos criados`,
    );
    setOpen(false);
  }

  async function toggleAtivo(mapeamento: Mapeamento) {
    const ativo = !mapeamento.ativo;
    const { error } = await apiClient
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

    setDeletingLoading(true);
    const { error } = await apiClient.from("mapeamentos_sku").delete().eq("id", deleting.id);
    setDeletingLoading(false);

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
        title="Mapeamento de produtos"
        description="Conecte o produto da ConstruJota ao Cód. equivalente em cada concorrente."
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
          A comparação depende deste mapeamento manual. Cada linha conecta um produto interno ao
          Cód. equivalente exibido no site do concorrente.
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(220px,1fr)_260px_320px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Pesquisar..."
                className="pl-9"
              />
            </div>

            <Select value={familiaFilter} onValueChange={changeFamiliaFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Família" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as famílias</SelectItem>
                {familias.map((familia) => (
                  <SelectItem key={familia.id} value={familia.id}>
                    {familia.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={produtoFilter} onValueChange={setProdutoFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Produto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                {produtosDoFiltro.map((produto) => (
                  <SelectItem key={produto.id} value={produto.id}>
                    {produto.sku_interno} - {produto.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto CJ</TableHead>
                  <TableHead>SKU CJ</TableHead>
                  <TableHead>Concorrente</TableHead>
                  <TableHead>Cód. Conc.</TableHead>
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
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{editing ? "Editar mapeamento" : "Novo mapeamento"}</DialogTitle>
            <DialogDescription>
              Defina a equivalência entre o produto interno e o produto do concorrente.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto px-6 py-4 sm:grid-cols-2">
            {editing ? (
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
            ) : (
              <div className="space-y-4 sm:col-span-2">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Como deseja selecionar?</Label>
                    <Select
                      value={form.selection_mode}
                      onValueChange={(value: "all" | "family" | "products") =>
                        setForm({
                          ...form,
                          selection_mode: value,
                          familia_id: "",
                          produto_ids: [],
                          detalhes_por_concorrente: {},
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as famílias</SelectItem>
                        <SelectItem value="family">Uma família</SelectItem>
                        <SelectItem value="products">Produtos específicos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {form.selection_mode === "family" && (
                    <div className="space-y-1.5">
                      <Label>Família</Label>
                      <Select
                        value={form.familia_id || undefined}
                        onValueChange={(value) =>
                          setForm({
                            ...form,
                            familia_id: value,
                            detalhes_por_concorrente: {},
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione" />
                        </SelectTrigger>
                        <SelectContent>
                          {familias.map((familia) => (
                            <SelectItem key={familia.id} value={familia.id}>
                              {familia.nome}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {form.selection_mode === "products" && (
                  <div className="rounded-md border p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <Label>Produtos por família</Label>
                      <span className="text-xs text-muted-foreground">
                        {form.produto_ids.length} selecionado(s)
                      </span>
                    </div>
                    <div className="max-h-52 space-y-4 overflow-y-auto pr-1">
                      {produtosPorFamilia.map((grupo) => {
                        const ids = grupo.produtos.map((produto) => produto.id);
                        const selectedCount = ids.filter((id) =>
                          form.produto_ids.includes(id),
                        ).length;
                        const allChecked = selectedCount === ids.length;

                        return (
                          <div key={grupo.id} className="space-y-2">
                            <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
                              <Checkbox
                                checked={allChecked}
                                onCheckedChange={(checked) =>
                                  toggleFamiliaProdutos(grupo.produtos, checked === true)
                                }
                              />
                              <span>{grupo.nome}</span>
                              <span className="text-xs font-normal text-muted-foreground">
                                {selectedCount}/{ids.length}
                              </span>
                            </label>
                            <div className="space-y-1 border-l pl-6">
                              {grupo.produtos.map((produto) => (
                                <label
                                  key={produto.id}
                                  className="flex cursor-pointer items-center gap-3 py-1 text-sm"
                                >
                                  <Checkbox
                                    checked={form.produto_ids.includes(produto.id)}
                                    onCheckedChange={(checked) =>
                                      toggleProduto(produto.id, checked)
                                    }
                                  />
                                  <span className="font-mono text-xs">{produto.sku_interno}</span>
                                  <span>{produto.nome}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {form.selection_mode !== "products" && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    {selectedProdutos.length} produto(s) serão mapeados neste cadastro.
                  </div>
                )}
              </div>
            )}
            {editing ? (
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
            ) : (
              <div className="space-y-2">
                <Label>Concorrentes</Label>
                <div className="max-h-32 overflow-y-auto rounded-md border p-3">
                  {concorrentes.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      Nenhum concorrente ativo encontrado.
                    </p>
                  )}
                  {concorrentes.map((concorrente) => (
                    <label
                      key={concorrente.id}
                      className="flex cursor-pointer items-center gap-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={form.concorrente_ids.includes(concorrente.id)}
                        onCheckedChange={(checked) => toggleConcorrente(concorrente.id, checked)}
                      />
                      <span>{concorrente.nome}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Selecione um ou mais concorrentes para criar os mapeamentos de uma vez.
                </p>
              </div>
            )}
            {activeMappingConflicts.length > 0 && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm sm:col-span-2">
                <div className="flex items-center gap-2 font-medium text-destructive">
                  <TriangleAlert className="h-4 w-4 shrink-0" />
                  Já existe mapeamento ativo para:
                </div>
                <ul className="list-disc space-y-1 pl-6 text-muted-foreground">
                  {activeMappingConflicts.map((mapeamento) => (
                    <li key={mapeamento.id}>
                      {mapeamento.produtos?.sku_interno} - {mapeamento.produtos?.nome} em{" "}
                      {mapeamento.concorrentes?.nome}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  Desmarque a combinação ou desative o mapeamento existente para continuar.
                </p>
              </div>
            )}
            {editing ? (
              <>
                <div className="space-y-1.5">
                  <Label>Cód. no concorrente (opcional)</Label>
                  <Input
                    value={form.sku_concorrente}
                    onChange={(event) => setForm({ ...form, sku_concorrente: event.target.value })}
                    placeholder="Ex: Código, Cód. ou Cod: exibido no site"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Unidade equivalente (opcional)</Label>
                  <Input
                    value={form.unidade_equivalente}
                    onChange={(event) =>
                      setForm({ ...form, unidade_equivalente: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>URL do produto (opcional)</Label>
                  <Input
                    value={form.url_produto}
                    onChange={(event) => setForm({ ...form, url_produto: event.target.value })}
                  />
                </div>
                <Collapsible
                  open={advancedOpen}
                  onOpenChange={setAdvancedOpen}
                  className="sm:col-span-2"
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
                    >
                      Opções avançadas
                      <ChevronDown
                        className={`ml-1 h-4 w-4 transition-transform ${
                          advancedOpen ? "rotate-180" : ""
                        }`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="space-y-1.5">
                      <Label>Seletor de preço</Label>
                      <Input
                        value={form.seletor_preco}
                        onChange={(event) =>
                          setForm({ ...form, seletor_preco: event.target.value })
                        }
                        placeholder="ex: .product-price__value"
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Observações</Label>
                  <Textarea
                    value={form.observacoes}
                    onChange={(event) => setForm({ ...form, observacoes: event.target.value })}
                  />
                </div>
              </>
            ) : (
              <div className="space-y-4 sm:col-span-2">
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  {selectedProdutos.length * form.concorrente_ids.length} mapeamento(s) serão
                  criados. Deixe as informações vazias quando o concorrente não tiver o produto.
                </div>

                {selectedProdutos.map((produto) =>
                  form.concorrente_ids.map((concorrenteId) => {
                    const concorrente = concorrentes.find((item) => item.id === concorrenteId);
                    const key = detailKey(produto.id, concorrenteId);
                    const details = form.detalhes_por_concorrente[key] ?? emptyDetails;

                    return (
                      <div key={key} className="rounded-md border p-4">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{concorrente?.nome ?? "Concorrente"}</Badge>
                          <span className="font-mono text-xs text-muted-foreground">
                            {produto.sku_interno}
                          </span>
                          <h3 className="text-sm font-semibold">{produto.nome}</h3>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label>Cód. no concorrente (opcional)</Label>
                            <Input
                              value={details.sku_concorrente}
                              onChange={(event) =>
                                updateConcorrenteDetail(key, "sku_concorrente", event.target.value)
                              }
                              placeholder="Ex: Código, Cód. ou Cod: exibido no site"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Unidade equivalente (opcional)</Label>
                            <Input
                              value={details.unidade_equivalente}
                              onChange={(event) =>
                                updateConcorrenteDetail(
                                  key,
                                  "unidade_equivalente",
                                  event.target.value,
                                )
                              }
                            />
                          </div>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>URL do produto (opcional)</Label>
                            <Input
                              value={details.url_produto}
                              onChange={(event) =>
                                updateConcorrenteDetail(key, "url_produto", event.target.value)
                              }
                            />
                          </div>
                          <Collapsible className="sm:col-span-2">
                            <CollapsibleTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-auto px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
                              >
                                Opções avançadas
                                <ChevronDown className="ml-1 h-4 w-4" />
                              </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-2">
                              <div className="space-y-1.5">
                                <Label>Seletor de preço</Label>
                                <Input
                                  value={details.seletor_preco}
                                  onChange={(event) =>
                                    updateConcorrenteDetail(
                                      key,
                                      "seletor_preco",
                                      event.target.value,
                                    )
                                  }
                                  placeholder="ex: .product-price__value"
                                />
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                          <div className="space-y-1.5 sm:col-span-2">
                            <Label>Observações</Label>
                            <Textarea
                              value={details.observacoes}
                              onChange={(event) =>
                                updateConcorrenteDetail(key, "observacoes", event.target.value)
                              }
                            />
                          </div>
                        </div>
                      </div>
                    );
                  }),
                )}
              </div>
            )}
          </div>
          <DialogFooter className="border-t px-6 py-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              onClick={save}
              disabled={saving || activeMappingConflicts.length > 0}
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
              Essa ação remove o mapeamento e também apaga o histórico de preços vinculado a ele.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingLoading}
              onClick={(event) => {
                event.preventDefault();
                void deleteMapeamento();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingLoading ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
