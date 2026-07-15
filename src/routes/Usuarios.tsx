import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, ShieldCheck, ShieldX, Trash2, UserCog } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AppUser, roleLabel, UserRole, useAuth } from "@/lib/auth";
import { apiClient } from "@/lib/api-client";

type FormState = {
  id?: string;
  nome: string;
  email: string;
  role: UserRole | "";
  password: string;
  ativo: boolean;
};

const empty: FormState = {
  nome: "",
  email: "",
  role: "",
  password: "",
  ativo: true,
};

const roleBadge: Record<UserRole, string> = {
  admin: "bg-primary text-primary-foreground",
  operador: "bg-secondary text-secondary-foreground border border-border",
  visualizador: "bg-muted text-muted-foreground",
};

export default function Usuarios() {
  const { user: current } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [confirmDel, setConfirmDel] = useState<AppUser | null>(null);

  const isAdmin = current?.role === "admin";

  const refreshUsers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await apiClient
      .from("profiles")
      .select("id,nome,email,role,ativo,created_at")
      .order("nome", { ascending: true });

    if (error) {
      toast.error("Não foi possível carregar usuários.");
      setLoading(false);
      return;
    }

    setUsers((data ?? []) as AppUser[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.nome.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        roleLabel[u.role].toLowerCase().includes(q),
    );
  }, [users, query]);

  const openNew = () => {
    setForm(empty);
    setOpen(true);
  };

  const openEdit = (u: AppUser) => {
    setForm({
      id: u.id,
      nome: u.nome,
      email: u.email,
      role: u.role,
      password: "",
      ativo: u.ativo,
    });
    setOpen(true);
  };

  const callAdminUsers = async (payload: Record<string, unknown>) => {
    const { data, error } = await apiClient.functions.invoke("admin-users", {
      body: payload,
    });

    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
  };

  const save = async () => {
    if (!isAdmin) {
      toast.error("Apenas administradores podem gerenciar usuários.");
      return;
    }

    if (!form.nome.trim() || !/^\S+@\S+\.\S+$/.test(form.email) || !form.role) {
      toast.error("Informe nome, e-mail válido e função.");
      return;
    }

    if (!form.id && form.password.length < 6) {
      toast.error("A senha inicial deve ter no mínimo 6 caracteres.");
      return;
    }

    setSaving(true);
    try {
      const payload = form.id
        ? {
            action: "update",
            id: form.id,
            nome: form.nome,
            email: form.email,
            role: form.role as UserRole,
            ativo: form.ativo,
            ...(form.password ? { password: form.password } : {}),
          }
        : {
            action: "create",
            nome: form.nome,
            email: form.email,
            password: form.password,
            role: form.role as UserRole,
            ativo: form.ativo,
          };

      await callAdminUsers(payload);
      await refreshUsers();
      setQuery("");
      toast.success(form.id ? "Usuário atualizado." : "Usuário criado.");
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar o usuário.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirmDel) return;

    setSaving(true);
    try {
      await callAdminUsers({ action: "delete", id: confirmDel.id });
      await refreshUsers();
      setQuery("");
      toast.success("Usuário excluído.");
      setConfirmDel(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível excluir o usuário.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        description="Cadastre, atualize senha e gerencie quem acessa o Radar ConstruJota."
        actions={
          isAdmin && (
            <Button
              onClick={openNew}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo usuário
            </Button>
          )
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="h-5 w-5 text-primary" />
            {filtered.length} usuário{filtered.length !== 1 ? "s" : ""} exibido
            {filtered.length !== 1 ? "s" : ""}
          </CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, e-mail ou função..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  {isAdmin && <TableHead className="text-right">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold">
                          {u.nome
                            .split(" ")
                            .map((n) => n[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase()}
                        </div>
                        <div>
                          <div>{u.nome}</div>
                          {current?.id === u.id && <div className="text-xs text-primary">você</div>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge className={roleBadge[u.role]}>{roleLabel[u.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium">
                        {u.ativo ? (
                          <>
                            <ShieldCheck className="h-3.5 w-3.5 text-success" />
                            <span className="text-success">Ativo</span>
                          </>
                        ) : (
                          <>
                            <ShieldX className="h-3.5 w-3.5 text-destructive" />
                            <span className="text-destructive">Inativo</span>
                          </>
                        )}
                      </span>
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={current?.id === u.id}
                          onClick={() => setConfirmDel(u)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!loading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={isAdmin ? 5 : 4}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Nenhum usuário encontrado.
                    </TableCell>
                  </TableRow>
                )}
                {loading && (
                  <TableRow>
                    <TableCell
                      colSpan={isAdmin ? 5 : 4}
                      className="py-10 text-center text-muted-foreground"
                    >
                      Carregando usuários...
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar usuário" : "Novo usuário"}</DialogTitle>
            <DialogDescription>
              {form.id
                ? "Atualize os dados do usuário. Preencha a senha apenas se quiser alterá-la."
                : "Crie um usuário com uma senha inicial."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Nome completo</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Função</Label>
                <Select
                  value={form.role || undefined}
                  onValueChange={(value: UserRole) => setForm({ ...form, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="operador">Operador</SelectItem>
                    <SelectItem value="visualizador">Visualizador</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <div className="flex h-10 items-center gap-3 rounded-md border px-3">
                  <Switch
                    checked={form.ativo}
                    disabled={form.id === current?.id}
                    onCheckedChange={(value) => setForm({ ...form, ativo: value })}
                  />
                  <span className="text-sm">{form.ativo ? "Ativo" : "Inativo"}</span>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{form.id ? "Nova senha" : "Senha inicial"}</Label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={form.id ? "Deixe em branco para manter" : "Mínimo 6 caracteres"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Salvando..." : form.id ? "Salvar alterações" : "Criar usuário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(value) => !value && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário <strong>{confirmDel?.nome}</strong> perderá acesso imediatamente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              disabled={saving}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
