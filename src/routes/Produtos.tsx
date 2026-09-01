import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
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
import { formatBRL, formatDateTime } from "@/lib/format";
import { sortByProductName } from "@/lib/product-sort";
import { apiClient } from "@/lib/api-client";
import {
  ExternalLink,
  FileSpreadsheet,
  Pencil,
  Plus,
  Power,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

type FamiliaOption = {
  id: string;
  nome: string;
  ativo: boolean;
};

type ConstruJotaMercosMapping = {
  id: string;
  sku_site: string;
  mercos_produto_id: string | null;
  url_produto: string | null;
  ativo: boolean;
  ultimo_preco: number | null;
  ultimo_sucesso_em: string | null;
  ultima_tentativa_em: string | null;
  ultimo_status: string | null;
  ultimo_erro: string | null;
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
  construjota_mercos?: ConstruJotaMercosMapping | ConstruJotaMercosMapping[] | null;
  mapeamentos_construjota_mercos?: ConstruJotaMercosMapping | ConstruJotaMercosMapping[] | null;
};

type ProdutoForm = {
  sku_interno: string;
  nome: string;
  familia_id: string;
  unidade: string;
  preco_atual: string;
  url_construjota_mercos: string;
  observacoes: string;
};

type ImportRow = {
  rowNumber: number;
  sku: string;
  unidade: string;
  nome: string;
  familia: string;
  preco: number | null;
  error?: string;
};

const emptyForm: ProdutoForm = {
  sku_interno: "",
  nome: "",
  familia_id: "",
  unidade: "",
  preco_atual: "",
  url_construjota_mercos: "",
  observacoes: "",
};

function normalizeMercosMapping(
  value: Produto["construjota_mercos"],
): ConstruJotaMercosMapping | null {
  const mapping = Array.isArray(value) ? (value[0] ?? null) : value;
  if (!mapping) return null;
  return {
    ...mapping,
    ultimo_preco:
      mapping.ultimo_preco === null || mapping.ultimo_preco === undefined
        ? null
        : Number(mapping.ultimo_preco),
  };
}

function normalizeProduto(row: Produto): Produto {
  const mercosMapping = normalizeMercosMapping(
    row.construjota_mercos ?? row.mapeamentos_construjota_mercos,
  );
  return {
    ...row,
    preco_atual: Number(row.preco_atual ?? 0),
    construjota_mercos: mercosMapping,
    mapeamentos_construjota_mercos: mercosMapping,
  };
}

function validateMercosProductUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "construjota2.mercos.com" &&
      /^\/produtos\/\d+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function mercosProductIdFromUrl(value: string) {
  return value.match(/\/produtos\/(\d+)\/?$/)?.[1] ?? null;
}

function databaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function mercosStatusBadge(mapping: ConstruJotaMercosMapping | null) {
  if (!mapping?.url_produto) return <Badge variant="secondary">Sem URL</Badge>;
  if (mapping.ultimo_status === "sucesso") {
    return <Badge className="bg-success text-success-foreground">Sincronizado</Badge>;
  }
  if (mapping.ultimo_status?.startsWith("indisponivel")) {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        Indisponível
      </Badge>
    );
  }
  if (mapping.ultimo_status === "erro") return <Badge variant="destructive">Erro</Badge>;
  if (!mapping.ultimo_status || mapping.ultimo_status === "pendente") {
    return <Badge variant="secondary">Aguardando leitura</Badge>;
  }
  return <Badge variant="destructive">Erro</Badge>;
}

function MercosProductStatus({ produto }: { produto: Produto }) {
  const mapping = normalizeMercosMapping(produto.construjota_mercos);
  const unavailable = mapping?.ultimo_status?.startsWith("indisponivel");

  return (
    <div className="min-w-56 space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {mercosStatusBadge(mapping)}
        {mapping?.url_produto && (
          <a
            href={mapping.url_produto}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            Abrir produto <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {unavailable && (
        <div className="text-xs text-amber-700 dark:text-amber-300">
          Último preço confirmado preservado
          {mapping?.ultimo_sucesso_em
            ? ` em ${formatDateTime(mapping.ultimo_sucesso_em)}`
            : ", sem leitura anterior"}
        </div>
      )}
      {!unavailable && mapping?.ultimo_sucesso_em && (
        <div className="text-xs text-muted-foreground">
          Último sucesso: {formatDateTime(mapping.ultimo_sucesso_em)}
        </div>
      )}
      {mapping?.ultimo_erro && mapping.ultimo_status !== "sucesso" && (
        <div
          className={`max-w-72 truncate text-xs ${
            unavailable ? "text-amber-700 dark:text-amber-300" : "text-destructive"
          }`}
          title={mapping.ultimo_erro}
        >
          {mapping.ultimo_erro}
        </div>
      )}
    </div>
  );
}

export default function Produtos() {
  const [list, setList] = useState<Produto[]>([]);
  const [familias, setFamilias] = useState<FamiliaOption[]>([]);
  const [q, setQ] = useState("");
  const [familiaFilter, setFamiliaFilter] = useState("todas");
  const [statusFilter, setStatusFilter] = useState("todos");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Produto | null>(null);
  const [deleting, setDeleting] = useState<Produto | null>(null);
  const [form, setForm] = useState<ProdutoForm>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingLoading, setDeletingLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importFilename, setImportFilename] = useState("");
  const [importing, setImporting] = useState(false);

  const refreshData = useCallback(async (options: { silent?: boolean } = {}) => {
    const [familiasResult, produtosResult] = await Promise.all([
      apiClient.from("familias").select("id,nome,ativo").order("nome", { ascending: true }),
      apiClient
        .from("produtos")
        .select(
          "id,sku_interno,nome,familia_id,unidade,preco_atual,observacoes,ativo,familias(nome),construjota_mercos:mapeamentos_construjota_mercos(id,sku_site,mercos_produto_id,url_produto,ativo,ultimo_preco,ultimo_sucesso_em,ultima_tentativa_em,ultimo_status,ultimo_erro)",
        )
        .order("nome", { ascending: true }),
    ]);

    if (familiasResult.error || produtosResult.error) {
      if (!options.silent) toast.error("Não foi possível carregar os produtos");
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
  }, []);

  useEffect(() => {
    void refreshData();

    const refreshSilently = () => void refreshData({ silent: true });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshSilently();
    };
    const intervalId = window.setInterval(refreshSilently, 60_000);
    window.addEventListener("focus", refreshSilently);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshSilently);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshData]);

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
      url_construjota_mercos: normalizeMercosMapping(produto.construjota_mercos)?.url_produto ?? "",
      observacoes: produto.observacoes,
    });
    setOpen(true);
  }

  async function save() {
    const sku = form.sku_interno.trim();
    const nome = form.nome.trim();
    const mercosUrl = form.url_construjota_mercos.trim();
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

    if (!validateMercosProductUrl(mercosUrl)) {
      toast.error("Informe uma URL de produto valida de construjota2.mercos.com");
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

    async function saveMercosMapping(produtoId: string) {
      const currentMapping = editing ? normalizeMercosMapping(editing.construjota_mercos) : null;
      const mappingPayload = {
        produto_id: produtoId,
        sku_site: sku,
        mercos_produto_id: mercosProductIdFromUrl(mercosUrl),
        url_produto: mercosUrl,
        ativo: Boolean(mercosUrl),
        ...(currentMapping?.url_produto !== mercosUrl || currentMapping?.sku_site !== sku
          ? { ultimo_status: "pendente", ultimo_erro: null }
          : {}),
      };

      if (currentMapping?.id) {
        return apiClient
          .from("mapeamentos_construjota_mercos")
          .update(mappingPayload)
          .eq("id", currentMapping.id);
      }
      if (mercosUrl) {
        return apiClient.from("mapeamentos_construjota_mercos").insert({
          ...mappingPayload,
          ultimo_status: "pendente",
        });
      }
      return { error: null };
    }

    if (editing) {
      const { data, error } = await apiClient
        .from("produtos")
        .update(payload)
        .eq("id", editing.id)
        .select(
          "id,sku_interno,nome,familia_id,unidade,preco_atual,observacoes,ativo,familias(nome)",
        )
        .single();

      if (error || !data) {
        setSaving(false);
        toast.error(
          databaseErrorCode(error) === "23505"
            ? "Já existe um produto com esse SKU"
            : "Não foi possível atualizar o produto",
        );
        return;
      }

      const mercosResult = await saveMercosMapping(editing.id);
      if (mercosResult.error) {
        setSaving(false);
        toast.error("Produto salvo, mas nao foi possivel salvar a URL da ConstruJota Mercos");
        await refreshData();
        return;
      }

      await refreshData();
      setSaving(false);
      toast.success("Produto atualizado");
      setOpen(false);
      return;
    }

    const { data, error } = await apiClient
      .from("produtos")
      .insert({ ...payload, ativo: true })
      .select("id,sku_interno,nome,familia_id,unidade,preco_atual,observacoes,ativo,familias(nome)")
      .single();

    if (error || !data) {
      setSaving(false);
      toast.error(
        databaseErrorCode(error) === "23505"
          ? "Já existe um produto com esse SKU"
          : "Não foi possível cadastrar o produto",
      );
      return;
    }

    const produto = normalizeProduto(data as Produto);
    const mercosResult = await saveMercosMapping(produto.id);
    if (mercosResult.error) {
      setSaving(false);
      toast.error("Produto salvo, mas nao foi possivel salvar a URL da ConstruJota Mercos");
      await refreshData();
      return;
    }

    await refreshData();
    setSaving(false);
    toast.success("Produto cadastrado");
    setOpen(false);
  }

  async function toggleAtivo(produto: Produto) {
    const ativo = !produto.ativo;
    const { error } = await apiClient.from("produtos").update({ ativo }).eq("id", produto.id);

    if (error) {
      toast.error("Não foi possível alterar o status do produto");
      return;
    }

    setList((current) =>
      current.map((item) => (item.id === produto.id ? { ...item, ativo } : item)),
    );
  }

  async function deleteProduto() {
    if (!deleting) return;

    setDeletingLoading(true);
    const { error } = await apiClient.from("produtos").delete().eq("id", deleting.id);
    setDeletingLoading(false);

    if (error) {
      toast.error("Nao foi possivel excluir o produto");
      return;
    }

    setList((current) => current.filter((item) => item.id !== deleting.id));
    setDeleting(null);
    toast.success("Produto excluido");
  }

  function normalizeHeader(value: unknown) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function parsePrice(value: unknown) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value ?? "")
      .trim()
      .replace(/\s/g, "");
    if (!text) return null;
    const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    const price = Number(normalized.replace(/[^\d.-]/g, ""));
    return Number.isFinite(price) && price >= 0 ? price : null;
  }

  async function readSpreadsheet(file: File) {
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" });
      if (data.length === 0) throw new Error("Planilha vazia");

      const headers = (data[0] as unknown[]).map(normalizeHeader);
      const findColumn = (...names: string[]) =>
        headers.findIndex((header) => names.includes(header));
      const columns = {
        sku: findColumn("sku interno", "sku", "sku_interno"),
        unidade: findColumn("unidade", "un"),
        nome: findColumn("nome", "produto"),
        familia: findColumn("familia", "família"),
        preco: findColumn("preco atual", "preço atual", "preco", "preço"),
      };
      if (Object.values(columns).some((column) => column < 0)) {
        throw new Error("Use as colunas: SKU interno, Unidade, Nome, Família e Preço atual");
      }

      const parsed = data.slice(1).flatMap((raw, index) => {
        const cells = raw as unknown[];
        if (cells.every((cell) => String(cell).trim() === "")) return [];
        const row: ImportRow = {
          rowNumber: index + 2,
          sku: String(cells[columns.sku] ?? "").trim(),
          unidade: String(cells[columns.unidade] ?? "").trim(),
          nome: String(cells[columns.nome] ?? "").trim(),
          familia: String(cells[columns.familia] ?? "").trim(),
          preco: parsePrice(cells[columns.preco]),
        };
        const missing = [
          !row.sku && "SKU",
          !row.nome && "nome",
          !row.familia && "família",
          row.preco === null && "preço",
        ].filter(Boolean);
        if (missing.length) row.error = `Preencha: ${missing.join(", ")}`;
        return [row];
      });

      const skuCounts = new Map<string, number>();
      parsed.forEach((row) => {
        const key = normalizeHeader(row.sku);
        if (key) skuCounts.set(key, (skuCounts.get(key) ?? 0) + 1);
      });
      parsed.forEach((row) => {
        if ((skuCounts.get(normalizeHeader(row.sku)) ?? 0) > 1) {
          row.error = row.error ? `${row.error}; SKU repetido` : "SKU repetido na planilha";
        }
      });

      setImportFilename(file.name);
      setImportRows(parsed);
      setImportOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler a planilha");
    }
  }

  async function importSpreadsheet() {
    const validRows = importRows.filter((row) => !row.error && row.preco !== null);
    if (validRows.length === 0) return;
    setImporting(true);

    const familyByName = new Map(familias.map((f) => [normalizeHeader(f.nome), f]));
    for (const familyName of new Set(validRows.map((row) => row.familia))) {
      const key = normalizeHeader(familyName);
      if (familyByName.has(key)) continue;
      const { data, error } = await apiClient
        .from("familias")
        .insert({ nome: familyName, descricao: "Criada pela importação de produtos", ativo: true })
        .select("id,nome,ativo")
        .single();
      if (error || !data) {
        setImporting(false);
        toast.error(`Não foi possível cadastrar a família ${familyName}`);
        return;
      }
      familyByName.set(key, data as FamiliaOption);
    }

    const productBySku = new Map(
      list.map((produto) => [normalizeHeader(produto.sku_interno), produto]),
    );
    let inserted = 0;
    let updated = 0;
    for (const row of validRows) {
      const payload = {
        sku_interno: row.sku,
        unidade: row.unidade,
        nome: row.nome,
        familia_id: familyByName.get(normalizeHeader(row.familia))?.id,
        preco_atual: row.preco,
        observacoes: "",
      };
      const existing = productBySku.get(normalizeHeader(row.sku));
      const result = existing
        ? await apiClient.from("produtos").update(payload).eq("id", existing.id)
        : await apiClient.from("produtos").insert({ ...payload, ativo: true });
      if (result.error) {
        setImporting(false);
        toast.error(`Importação interrompida no SKU ${row.sku}`);
        await refreshData();
        return;
      }
      if (existing) updated += 1;
      else inserted += 1;
    }

    setImporting(false);
    setImportOpen(false);
    setImportRows([]);
    await refreshData();
    toast.success(`${inserted} produto(s) cadastrado(s) e ${updated} atualizado(s)`);
  }

  return (
    <>
      <PageHeader
        title="Produtos ConstruJota"
        description="Catálogo interno de produtos que serão monitorados."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <label className="cursor-pointer">
                <Upload className="mr-1 h-4 w-4" /> Importar Excel
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readSpreadsheet(file);
                    event.target.value = "";
                  }}
                />
              </label>
            </Button>
            <Button
              onClick={openNew}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-1 h-4 w-4" /> Novo produto
            </Button>
          </div>
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
                  <TableHead>ConstruJota Mercos</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Carregando produtos...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
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
                      <MercosProductStatus produto={produto} />
                    </TableCell>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleting(produto)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
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
        <DialogContent className="max-w-2xl">
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
              <Label>URL do produto no portal ConstruJota Mercos</Label>
              <Input
                type="url"
                value={form.url_construjota_mercos}
                onChange={(event) =>
                  setForm({ ...form, url_construjota_mercos: event.target.value })
                }
                placeholder="https://construjota2.mercos.com/produtos/123456789"
              />
              <p className="text-xs text-muted-foreground">
                Esta URL alimenta o preco proprio da ConstruJota. Ela nao e um mapeamento de
                concorrente.
              </p>
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

      <Dialog open={importOpen} onOpenChange={(value) => !importing && setImportOpen(value)}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Importar produtos
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 overflow-hidden">
            <div className="text-sm text-muted-foreground">
              Arquivo: <span className="font-medium text-foreground">{importFilename}</span>. SKUs
              existentes serão atualizados e novas famílias serão cadastradas automaticamente.
            </div>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{importRows.length} linha(s)</Badge>
              <Badge className="bg-success text-success-foreground">
                {importRows.filter((row) => !row.error).length} válida(s)
              </Badge>
              {importRows.some((row) => row.error) && (
                <Badge variant="destructive">
                  {importRows.filter((row) => row.error).length} com erro
                </Badge>
              )}
            </div>
            <div className="max-h-[55vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Linha</TableHead>
                    <TableHead>SKU interno</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Família</TableHead>
                    <TableHead>Preço atual</TableHead>
                    <TableHead>Validação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importRows.map((row) => (
                    <TableRow key={`${row.rowNumber}-${row.sku}`}>
                      <TableCell>{row.rowNumber}</TableCell>
                      <TableCell className="font-mono text-xs">{row.sku || "—"}</TableCell>
                      <TableCell>{row.unidade || "—"}</TableCell>
                      <TableCell className="min-w-64 font-medium">{row.nome || "—"}</TableCell>
                      <TableCell>{row.familia || "—"}</TableCell>
                      <TableCell>{row.preco === null ? "—" : formatBRL(row.preco)}</TableCell>
                      <TableCell>
                        {row.error ? (
                          <span className="text-xs text-destructive">{row.error}</span>
                        ) : (
                          <Badge className="bg-success text-success-foreground">Válida</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
              Cancelar
            </Button>
            <Button
              onClick={() => void importSpreadsheet()}
              disabled={importing || importRows.every((row) => row.error)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {importing ? "Importando..." : "Confirmar importação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              Essa acao remove o produto e tambem apaga seus mapeamentos e historico de precos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLoading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingLoading}
              onClick={(event) => {
                event.preventDefault();
                void deleteProduto();
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
