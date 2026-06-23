import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Search, ShieldCheck, ShieldX, UserCog } from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AppUser, UserRole, loadUsers, roleLabel, saveUsers, useAuth } from "@/lib/auth";

type FormState = {
  id?: string;
  nome: string;
  email: string;
  role: UserRole;
  senha: string;
  ativo: boolean;
};

const empty: FormState = { nome: "", email: "", role: "operador", senha: "", ativo: true };

const roleBadge: Record<UserRole, string> = {
  admin: "bg-primary text-primary-foreground",
  operador: "bg-secondary text-secondary-foreground border border-border",
  visualizador: "bg-muted text-muted-foreground",
};

export default function Usuarios() {
  const { user: current } = useAuth();
  const [users, setUsers] = useState<AppUser[]>(() => loadUsers());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);
  const [confirmDel, setConfirmDel] = useState<AppUser | null>(null);

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

  const persist = (next: AppUser[]) => {
    setUsers(next);
    saveUsers(next);
  };

  const openNew = () => {
    setForm(empty);
    setOpen(true);
  };

  const openEdit = (u: AppUser) => {
    setForm({ ...u, senha: "" });
    setOpen(true);
  };

  const onSubmit = () => {
    if (!form.nome.trim() || !form.email.trim()) {
      toast.error("Preencha nome e e-mail.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      toast.error("E-mail inválido.");
      return;
    }
    const editing = !!form.id;
    if (!editing && !form.senha) {
      toast.error("Defina uma senha inicial para o novo usuário.");
      return;
    }
    const emailExists = users.some(
      (u) => u.email.toLowerCase() === form.email.toLowerCase() && u.id !== form.id,
    );
    if (emailExists) {
      toast.error("Já existe um usuário com este e-mail.");
      return;
    }

    if (editing) {
      const next = users.map((u) =>
        u.id === form.id
          ? {
              ...u,
              nome: form.nome.trim(),
              email: form.email.trim(),
              role: form.role,
              ativo: form.ativo,
              senha: form.senha ? form.senha : u.senha,
            }
          : u,
      );
      persist(next);
      toast.success("Usuário atualizado.");
    } else {
      const novo: AppUser = {
        id: `u${Date.now()}`,
        nome: form.nome.trim(),
        email: form.email.trim(),
        role: form.role,
        senha: form.senha,
        ativo: form.ativo,
        created_at: new Date().toISOString(),
      };
      persist([novo, ...users]);
      toast.success("Usuário cadastrado.");
    }
    setOpen(false);
  };

  const onDelete = (u: AppUser) => {
    if (current?.id === u.id) {
      toast.error("Você não pode excluir o próprio usuário logado.");
      return;
    }
    persist(users.filter((x) => x.id !== u.id));
    toast.success("Usuário excluído.");
    setConfirmDel(null);
  };

  const toggleAtivo = (u: AppUser) => {
    if (current?.id === u.id) {
      toast.error("Você não pode desativar o próprio usuário logado.");
      return;
    }
    persist(users.map((x) => (x.id === u.id ? { ...x, ativo: !x.ativo } : x)));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        description="Cadastre, edite e gerencie quem tem acesso ao Radar ConstruJota."
        actions={
          <Button onClick={openNew} className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="mr-2 h-4 w-4" />
            Novo usuário
          </Button>
        }
      />

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserCog className="h-5 w-5 text-primary" />
            {users.length} usuário{users.length !== 1 ? "s" : ""} cadastrado{users.length !== 1 ? "s" : ""}
          </CardTitle>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, e-mail ou função…"
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
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((u) => (
                  <TableRow key={u.id} className="transition-colors">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary font-semibold">
                          {u.nome.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <div>{u.nome}</div>
                          {current?.id === u.id && (
                            <div className="text-xs text-primary">você</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Badge className={roleBadge[u.role]}>{roleLabel[u.role]}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <button
                        onClick={() => toggleAtivo(u)}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-muted"
                      >
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
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(u)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDel(u)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      Nenhum usuário encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog create/edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar usuário" : "Novo usuário"}</DialogTitle>
            <DialogDescription>
              {form.id
                ? "Atualize os dados do usuário. Deixe a senha em branco para mantê-la."
                : "Defina uma senha inicial — o usuário poderá alterá-la depois."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Nome completo</Label>
              <Input
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: João da Silva"
              />
            </div>
            <div className="grid gap-2">
              <Label>E-mail (login)</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="usuario@construjota.com.br"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Função</Label>
                <Select
                  value={form.role}
                  onValueChange={(v: UserRole) => setForm({ ...form, role: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
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
                    onCheckedChange={(v) => setForm({ ...form, ativo: v })}
                  />
                  <span className="text-sm">{form.ativo ? "Ativo" : "Inativo"}</span>
                </div>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>{form.id ? "Nova senha (opcional)" : "Senha inicial"}</Label>
              <Input
                type="password"
                value={form.senha}
                onChange={(e) => setForm({ ...form, senha: e.target.value })}
                placeholder={form.id ? "Deixe em branco para manter" : "Mínimo 6 caracteres"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button
              onClick={onSubmit}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {form.id ? "Salvar alterações" : "Cadastrar usuário"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete */}
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário <strong>{confirmDel?.nome}</strong> perderá acesso imediatamente.
              Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDel && onDelete(confirmDel)}
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
