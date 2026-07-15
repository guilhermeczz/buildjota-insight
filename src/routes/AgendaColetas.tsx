import { useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/format";
import { apiClient } from "@/lib/api-client";
import { CalendarClock, Loader2, Save, Search } from "lucide-react";
import { toast } from "sonner";

const weekDays = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sab" },
  { value: 0, label: "Dom" },
];

type Familia = {
  id: string;
  nome: string;
  ativo: boolean;
};

type AgendaRow = {
  id?: string;
  familia_id: string;
  familia_nome: string;
  familia_ativo: boolean;
  ativo: boolean;
  horario: string;
  dias_semana: number[];
  concorrencia_maxima: number;
  observacoes: string;
  ultima_execucao: string | null;
  ultimo_status: "sucesso" | "parcial" | "erro" | "pendente" | null;
  ultimo_erro: string | null;
  dirty?: boolean;
  saving?: boolean;
};

type AgendaFromApi = Omit<AgendaRow, "familia_nome" | "familia_ativo"> & {
  familias?: Familia | null;
};

function normalizeTime(value: string) {
  return value ? String(value).slice(0, 5) : "";
}

function statusBadge(status: AgendaRow["ultimo_status"]) {
  if (!status) return <Badge variant="secondary">Sem coleta</Badge>;
  if (status === "sucesso")
    return <Badge className="bg-success text-success-foreground">Sucesso</Badge>;
  if (status === "parcial")
    return <Badge className="bg-primary text-primary-foreground">Parcial</Badge>;
  if (status === "erro") return <Badge variant="destructive">Erro</Badge>;
  return <Badge variant="secondary">Buscando</Badge>;
}

function defaultAgenda(familia: Familia): AgendaRow {
  return {
    familia_id: familia.id,
    familia_nome: familia.nome,
    familia_ativo: familia.ativo,
    ativo: false,
    horario: "",
    dias_semana: [1, 2, 3, 4, 5, 6],
    concorrencia_maxima: 1,
    observacoes: "",
    ultima_execucao: null,
    ultimo_status: null,
    ultimo_erro: null,
  };
}

export default function AgendaColetas() {
  const [rows, setRows] = useState<AgendaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");

  async function refresh() {
    const [familiasResult, agendaResult] = await Promise.all([
      apiClient.from("familias").select("id,nome,ativo").order("nome", { ascending: true }),
      apiClient
        .from("agenda_coletas")
        .select(
          "id,familia_id,ativo,horario,dias_semana,concorrencia_maxima,observacoes,ultima_execucao,ultimo_status,ultimo_erro,familias(id,nome,ativo)",
        )
        .order("horario", { ascending: true }),
    ]);

    if (familiasResult.error || agendaResult.error) {
      toast.error("Nao foi possivel carregar a agenda de coleta");
      setLoading(false);
      return;
    }

    const familias = (familiasResult.data ?? []) as Familia[];
    const agendas = new Map(
      ((agendaResult.data ?? []) as AgendaFromApi[]).map((agenda) => [agenda.familia_id, agenda]),
    );

    setRows(
      familias.map((familia) => {
        const agenda = agendas.get(familia.id);
        if (!agenda) return defaultAgenda(familia);

        return {
          id: agenda.id,
          familia_id: familia.id,
          familia_nome: familia.nome,
          familia_ativo: familia.ativo,
          ativo: agenda.ativo,
          horario: normalizeTime(agenda.horario),
          dias_semana: agenda.dias_semana?.map(Number) ?? [1, 2, 3, 4, 5, 6],
          concorrencia_maxima: Number(agenda.concorrencia_maxima ?? 1),
          observacoes: agenda.observacoes ?? "",
          ultima_execucao: agenda.ultima_execucao,
          ultimo_status: agenda.ultimo_status,
          ultimo_erro: agenda.ultimo_erro,
        };
      }),
    );
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (q && !row.familia_nome.toLowerCase().includes(q.toLowerCase())) return false;
        if (statusFilter === "ativas" && !row.ativo) return false;
        if (statusFilter === "inativas" && row.ativo) return false;
        if (statusFilter === "erro" && row.ultimo_status !== "erro") return false;
        return true;
      }),
    [q, rows, statusFilter],
  );

  function updateRow(familiaId: string, patch: Partial<AgendaRow>) {
    setRows((current) =>
      current.map((row) =>
        row.familia_id === familiaId ? { ...row, ...patch, dirty: true } : row,
      ),
    );
  }

  function toggleDay(row: AgendaRow, day: number) {
    const hasDay = row.dias_semana.includes(day);
    const dias = hasDay
      ? row.dias_semana.filter((item) => item !== day)
      : [...row.dias_semana, day];
    updateRow(row.familia_id, { dias_semana: dias.sort((a, b) => a - b) });
  }

  async function saveRow(row: AgendaRow) {
    if (row.ativo && !row.horario) {
      toast.error("Informe o horario da coleta");
      return;
    }
    if (row.dias_semana.length === 0) {
      toast.error("Selecione pelo menos um dia da semana");
      return;
    }

    updateRow(row.familia_id, { saving: true, dirty: row.dirty });

    const payload = {
      familia_id: row.familia_id,
      ativo: row.ativo,
      horario: row.horario || null,
      dias_semana: row.dias_semana,
      concorrencia_maxima: row.concorrencia_maxima,
      observacoes: row.observacoes,
    };

    const result = row.id
      ? await apiClient
          .from("agenda_coletas")
          .update(payload)
          .eq("id", row.id)
          .select(
            "id,familia_id,ativo,horario,dias_semana,concorrencia_maxima,observacoes,ultima_execucao,ultimo_status,ultimo_erro,familias(id,nome,ativo)",
          )
          .single()
      : await apiClient
          .from("agenda_coletas")
          .insert(payload)
          .select(
            "id,familia_id,ativo,horario,dias_semana,concorrencia_maxima,observacoes,ultima_execucao,ultimo_status,ultimo_erro,familias(id,nome,ativo)",
          )
          .single();

    if (result.error || !result.data) {
      updateRow(row.familia_id, { saving: false });
      toast.error("Nao foi possivel salvar a agenda");
      return;
    }

    const saved = result.data as AgendaFromApi;
    setRows((current) =>
      current.map((item) =>
        item.familia_id === row.familia_id
          ? {
              ...item,
              id: saved.id,
              ativo: saved.ativo,
              horario: normalizeTime(saved.horario),
              dias_semana: saved.dias_semana?.map(Number) ?? item.dias_semana,
              concorrencia_maxima: Number(saved.concorrencia_maxima ?? 1),
              observacoes: saved.observacoes ?? "",
              ultima_execucao: saved.ultima_execucao,
              ultimo_status: saved.ultimo_status,
              ultimo_erro: saved.ultimo_erro,
              dirty: false,
              saving: false,
            }
          : item,
      ),
    );
    toast.success("Agenda salva");
  }

  return (
    <>
      <PageHeader
        title="Agenda de Coleta"
        description="Defina os horarios automaticos por familia. Execucoes manuais ficam em Execucoes do Robo."
        actions={
          <Button variant="outline" onClick={() => void refresh()}>
            <CalendarClock className="mr-1 h-4 w-4" /> Atualizar
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Pesquisar familia..."
                className="pl-9"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
            >
              <option value="todos">Todas as familias</option>
              <option value="ativas">Coleta ativa</option>
              <option value="inativas">Coleta inativa</option>
              <option value="erro">Ultima com erro</option>
            </select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Familia</TableHead>
                  <TableHead>Ativa</TableHead>
                  <TableHead>Horario</TableHead>
                  <TableHead>Dias</TableHead>
                  <TableHead>Paralelo</TableHead>
                  <TableHead>Ultima coleta</TableHead>
                  <TableHead>Observacoes</TableHead>
                  <TableHead className="text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Carregando agenda...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                      Nenhuma familia encontrada.
                    </TableCell>
                  </TableRow>
                )}
                {filteredRows.map((row) => (
                  <TableRow key={row.familia_id}>
                    <TableCell>
                      <div className="font-medium">{row.familia_nome}</div>
                      {!row.familia_ativo && (
                        <div className="mt-1 text-xs text-muted-foreground">Familia inativa</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={row.ativo}
                        onCheckedChange={(checked) => {
                          if (checked && !row.horario) {
                            toast.error("Informe um horario antes de ativar a coleta");
                            return;
                          }
                          updateRow(row.familia_id, { ativo: checked });
                        }}
                        disabled={!row.familia_ativo}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="time"
                        value={row.horario}
                        onChange={(event) =>
                          updateRow(row.familia_id, { horario: event.target.value })
                        }
                        className="w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-64 flex-wrap gap-1.5">
                        {weekDays.map((day) => {
                          const selected = row.dias_semana.includes(day.value);
                          return (
                            <Button
                              key={day.value}
                              type="button"
                              size="sm"
                              variant={selected ? "default" : "outline"}
                              className="h-8 px-2"
                              onClick={() => toggleDay(row, day.value)}
                            >
                              {day.label}
                            </Button>
                          );
                        })}
                      </div>
                    </TableCell>
                    <TableCell>
                      <select
                        value={row.concorrencia_maxima}
                        onChange={(event) =>
                          updateRow(row.familia_id, {
                            concorrencia_maxima: Number(event.target.value),
                          })
                        }
                        className="flex h-9 w-20 rounded-md border border-input bg-transparent px-2 py-1 text-sm shadow-sm outline-none transition-colors focus:ring-1 focus:ring-ring"
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={4}>4</option>
                      </select>
                    </TableCell>
                    <TableCell className="min-w-44">
                      <div>{statusBadge(row.ultimo_status)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {row.ultima_execucao ? formatDateTime(row.ultima_execucao) : "-"}
                      </div>
                      {row.ultimo_erro && (
                        <div className="mt-1 max-w-52 truncate text-xs text-destructive">
                          {row.ultimo_erro}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Textarea
                        value={row.observacoes}
                        onChange={(event) =>
                          updateRow(row.familia_id, { observacoes: event.target.value })
                        }
                        placeholder="Opcional"
                        className="h-16 min-w-52 resize-none"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          onClick={() => void saveRow(row)}
                          disabled={row.saving || !row.dirty}
                        >
                          {row.saving ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-1 h-4 w-4" />
                          )}
                          Salvar
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            O worker verifica a agenda a cada minuto. Se uma coleta ainda estiver rodando, a proxima
            familia aguarda a vez e roda assim que o robo ficar livre.
          </div>
        </CardContent>
      </Card>
    </>
  );
}
