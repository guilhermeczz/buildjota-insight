import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Play, Info } from "lucide-react";
import { execucoes, formatDateTime } from "@/lib/mock-data";
import { toast } from "sonner";

export default function ExecucoesRobo() {
  return (
    <>
      <PageHeader
        title="Execuções do Robô"
        description="Histórico das execuções automáticas do robô externo de coleta de preços."
        actions={
          <Button
            onClick={() => toast.success("Execução manual registrada (mock). O robô externo será disparado em produção.")}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Play className="h-4 w-4 mr-1" /> Executar coleta manual
          </Button>
        }
      />

      <Card className="mb-4 border-secondary/30 bg-secondary text-secondary-foreground">
        <CardContent className="p-4 flex gap-3 items-start text-sm">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div>
            O robô de coleta será executado externamente, inicialmente via{" "}
            <strong>GitHub Actions</strong>, uma vez ao dia às <strong>08:00</strong>.
            Futuramente poderá ser migrado para uma VPS ou worker dedicado.
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardContent className="p-5">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Início</TableHead>
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
                {execucoes.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(e.iniciado_em)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(e.finalizado_em)}</TableCell>
                    <TableCell>
                      {e.status === "sucesso" && <Badge className="bg-success text-success-foreground">Sucesso</Badge>}
                      {e.status === "parcial" && <Badge className="bg-primary text-primary-foreground">Parcial</Badge>}
                      {e.status === "erro" && <Badge variant="destructive">Erro</Badge>}
                    </TableCell>
                    <TableCell><Badge variant="outline">{e.origem}</Badge></TableCell>
                    <TableCell>{e.total_processados}</TableCell>
                    <TableCell className="text-success">{e.total_sucesso}</TableCell>
                    <TableCell className="text-destructive">{e.total_erro}</TableCell>
                    <TableCell className="text-xs">{Math.floor(e.tempo_execucao_segundos / 60)}:{String(e.tempo_execucao_segundos % 60).padStart(2, "0")}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{e.mensagem}</TableCell>
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
