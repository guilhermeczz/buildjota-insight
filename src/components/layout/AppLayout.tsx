import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

export default function AppLayout() {
  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0 lg:pl-72">
        <Topbar />
        <main className="flex-1 p-6 lg:p-8">
          <Outlet />
        </main>
        <footer className="border-t bg-secondary text-secondary-foreground/70 py-3 text-center text-xs">
          Radar ConstruJota © 2026 — Todos os direitos reservados
        </footer>
      </div>
    </div>
  );
}
