import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="text-7xl font-black text-primary">404</div>
      <h2 className="mt-4 text-2xl font-bold">Página não encontrada</h2>
      <p className="mt-2 text-muted-foreground max-w-md">
        A rota que você tentou acessar não existe neste painel.
      </p>
      <Button asChild className="mt-6 bg-primary text-primary-foreground hover:bg-primary/90">
        <Link to="/dashboard">Voltar ao dashboard</Link>
      </Button>
    </div>
  );
}
