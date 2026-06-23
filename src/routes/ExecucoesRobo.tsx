import { useEffect, useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Play } from "lucide-react";
import { toast } from "sonner";

type Execucao = {
  id: string;
  status: "sucesso" | "parcial" | "erro" | "pendente";
  origem: "manual" | "edge_function" | "worker" | "agendado";
  iniciado_em: string;
  finalizado_em: string | null;
  total_processados: number;
  total_sucesso: number;
  total_erro: number;
  mensagem: string;
  tempo_execucao_segundos: number;
};

function durationLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function statusBadge(status: Execucao["status"]) {
  if (status === "sucesso") {
    return <Badge className="bg-success text-success-foreground">Sucesso</Badge>;
  }
  if (status === "parcial") {
    return <Badge className="bg-primary text-primary-foreground">Parcial</Badge>;
  }
  if (status === "erro") {
    return <Badge variant="destructive">Erro</Badge>;
  }
  return <Badge variant="secondary">Pendente</Badge>;
}

export default function ExecucoesRobo() {
  const [execucoes, setExecucoes] = useState<Execucao[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshExecucoes() {
    const { data, error } = await supabase
      .from("execucoes_robo")
      .select(
        "id,status,origem,iniciado_em,finalizado_em,total_processados,total_sucesso,total_erro,mensagem,tempo_execucao_segundos",
      )
      .order("iniciado_em", { ascending: false })
      .limit(100);

    if (error) {
      toast.error("Nao foi possivel carregar as execucoes");
      setLoading(false);
      return;
    }

    setExecucoes((data ?? []) as Execucao[]);
    setLoading(false);
  }

  useEffect(() => {
    void refreshExecucoes();

    const channel = supabase
      .channel("execucoes-robo-page")
      .on("postgres_changes", { event: "*", schema: "public", table: "execucoes_robo" }, () => {
        void refreshExecucoes();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  return (
    <>
      <PageHeader
        title="Execucoes do Robo"
        description="Historico das execucoes registradas pelo worker de coleta de precos."
        actions={
          <Button
            onClick={() =>
              toast.info("A execucao manual sera habilitada quando o worker estiver configurado.")
            }
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Play className="mr-1 h-4 w-4" /> Executar coleta manual
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Fim</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>Processados</TableHead>
                  <TableHead>Sucesso</TableHead>
                  <TableHead>Erros</TableHead>
                  <TableHead>Tempo</TableHead>
                  <TableHead>Mensagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      Carregando execucoes...
                    </TableCell>
                  </TableRow>
                )}
                {!loading && execucoes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      Nenhuma execucao registrada.
                    </TableCell>
                  </TableRow>
                )}
                {execucoes.map((execucao) => (
                  <TableRow key={execucao.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(execucao.iniciado_em)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {execucao.finalizado_em ? formatDateTime(execucao.finalizado_em) : "-"}
                    </TableCell>
                    <TableCell>{statusBadge(execucao.status)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{execucao.origem}</Badge>
                    </TableCell>
                    <TableCell>{execucao.total_processados}</TableCell>
                    <TableCell className="text-success">{execucao.total_sucesso}</TableCell>
                    <TableCell className="text-destructive">{execucao.total_erro}</TableCell>
                    <TableCell className="text-xs">
                      {durationLabel(execucao.tempo_execucao_segundos)}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                      {execucao.mensagem || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
