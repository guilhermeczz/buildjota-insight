import { useState } from "react";
import PageHeader from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Info } from "lucide-react";
import { toast } from "sonner";

export default function Configuracoes() {
  const [form, setForm] = useState({
    empresa: "ConstruJota Atacadista",
    horario: "08:00",
    fuso: "America/Sao_Paulo",
    email: "alertas@construjota.com.br",
    alertas: true,
    percentual: 10,
    tema: "ConstruJota",
  });

  return (
    <>
      <PageHeader title="Configurações" description="Configurações gerais do sistema, robô de coleta e alertas." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader><CardTitle>Dados gerais</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nome da empresa</Label>
              <Input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Tema visual</Label>
              <Select value={form.tema} onValueChange={(v) => setForm({ ...form, tema: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ConstruJota">ConstruJota (padrão)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader><CardTitle>Coleta diária</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Horário da coleta</Label>
                <Input type="time" value={form.horario} onChange={(e) => setForm({ ...form, horario: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Fuso horário</Label>
                <Select value={form.fuso} onValueChange={(v) => setForm({ ...form, fuso: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
                    <SelectItem value="America/Manaus">America/Manaus</SelectItem>
                    <SelectItem value="UTC">UTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Percentual mínimo para destacar diferença</Label>
              <Input type="number" min={0} step={0.5} value={form.percentual} onChange={(e) => setForm({ ...form, percentual: parseFloat(e.target.value) })} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader><CardTitle>Alertas</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>E-mail para alertas</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="font-medium text-sm">Ativar alertas de erro</div>
                <div className="text-xs text-muted-foreground">Notificar por e-mail quando o robô apresentar falhas.</div>
              </div>
              <Switch checked={form.alertas} onCheckedChange={(v) => setForm({ ...form, alertas: v })} />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm border-primary/40 bg-primary/5">
          <CardHeader className="flex flex-row gap-2 items-center">
            <Info className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Infraestrutura</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <p>
              O sistema está preparado para MVP em <strong>Vercel + Supabase</strong>.
              O robô de coleta roda <strong>externamente</strong> em Node.js + Playwright,
              agendado via GitHub Actions.
            </p>
            <p>
              Em uma próxima fase, o robô poderá ser migrado para <strong>VPS</strong>{" "}
              para maior controle, estabilidade e execução dedicada.
            </p>
            <p className="text-muted-foreground text-xs">
              Credenciais de fornecedores nunca são armazenadas neste painel — ficam em variáveis de ambiente/Secrets do robô.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={() => toast.success("Configurações salvas")} className="bg-primary text-primary-foreground hover:bg-primary/90">
          Salvar configurações
        </Button>
      </div>
    </>
  );
}
