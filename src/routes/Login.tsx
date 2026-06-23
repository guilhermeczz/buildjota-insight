import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Eye, EyeOff, LogIn, Lock, Mail, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from?.pathname || "/dashboard";

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !senha) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      toast.error("Preencha e-mail e senha.");
      return;
    }
    setLoading(true);
    const res = await login(email, senha);
    setLoading(false);
    if (!res.ok) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      toast.error(res.error || "Falha ao entrar.");
      return;
    }
    toast.success("Bem-vindo ao Radar ConstruJota!");
    navigate(from, { replace: true });
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-secondary text-secondary-foreground">
      {/* Animated background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-primary/20 blur-3xl animate-pulse" />
        <div
          className="absolute -bottom-40 -right-40 h-[520px] w-[520px] rounded-full bg-primary/10 blur-3xl animate-pulse"
          style={{ animationDelay: "1.2s" }}
        />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--primary)/0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)/0.5) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-2xl border border-white/10 bg-secondary/60 shadow-2xl backdrop-blur lg:grid-cols-2">
          {/* Brand side */}
          <div className="relative hidden flex-col justify-between bg-gradient-to-br from-black via-secondary to-black p-10 lg:flex">
            <div className="flex items-center gap-3 animate-fade-in">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-2xl shadow-lg shadow-primary/30">
                CJ
              </div>
              <div className="leading-tight">
                <div className="text-xl font-extrabold tracking-tight text-white">
                  RADAR <span className="text-primary">CONSTRUJOTA</span>
                </div>
                <div className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                  Atacadista · Price Intelligence
                </div>
              </div>
            </div>

            <div className="space-y-5 animate-fade-in" style={{ animationDelay: "120ms" }}>
              <h2 className="text-3xl font-bold leading-tight text-white">
                Inteligência para <span className="text-primary">vender mais</span>
                <br /> e comprar melhor.
              </h2>
              <p className="text-sm text-white/70">
                Monitore os preços do mercado em tempo real, compare com seu catálogo
                e tome decisões mais rápidas e seguras.
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                <ShieldCheck className="h-4 w-4 text-primary" />
                Acesso controlado — apenas usuários autorizados pela administração.
              </div>
            </div>

            <div className="text-xs text-white/40">
              © 2025 ConstruJota Atacadista
            </div>
          </div>

          {/* Form side */}
          <div className="flex items-center justify-center p-6 sm:p-10">
            <form
              onSubmit={onSubmit}
              className={`w-full max-w-sm space-y-6 animate-scale-in ${shake ? "animate-[shake_0.5s]" : ""}`}
            >
              <div className="space-y-2 text-center lg:text-left">
                <div className="lg:hidden mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground font-black text-xl shadow-lg shadow-primary/30">
                  CJ
                </div>
                <h1 className="text-2xl font-bold text-white">Acessar o sistema</h1>
                <p className="text-sm text-white/60">
                  Entre com suas credenciais corporativas.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white/80">E-mail</Label>
                  <div className="group relative">
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-primary" />
                    <Input
                      id="email"
                      type="email"
                      autoComplete="username"
                      placeholder="seu.email@construjota.com.br"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="h-11 border-white/10 bg-white/5 pl-9 text-white placeholder:text-white/30 focus-visible:ring-primary"
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="senha" className="text-white/80">Senha</Label>
                  <div className="group relative">
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40 transition-colors group-focus-within:text-primary" />
                    <Input
                      id="senha"
                      type={showPwd ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      className="h-11 border-white/10 bg-white/5 px-9 text-white placeholder:text-white/30 focus-visible:ring-primary"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-white/40 transition hover:text-primary"
                      aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="group h-11 w-full bg-primary text-primary-foreground font-semibold shadow-lg shadow-primary/20 transition-transform hover:scale-[1.01] hover:bg-primary/90"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Entrando…
                  </>
                ) : (
                  <>
                    <LogIn className="mr-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    Entrar no Radar
                  </>
                )}
              </Button>

              <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/60">
                <div className="mb-1 font-semibold text-white/80">Credenciais de teste</div>
                <div>admin@construjota.com.br · <span className="text-primary">admin123</span></div>
              </div>

              <p className="text-center text-xs text-white/40">
                O cadastro de novos usuários é feito apenas pelo administrador.
              </p>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
