import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import AppLayout from "@/components/layout/AppLayout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { AuthProvider } from "@/lib/auth";
import Login from "@/routes/Login";
import Dashboard from "@/routes/Dashboard";
import Familias from "@/routes/Familias";
import Produtos from "@/routes/Produtos";
import Concorrentes from "@/routes/Concorrentes";
import MapeamentosSku from "@/routes/MapeamentosSku";
import HistoricoPrecos from "@/routes/HistoricoPrecos";
import MonitoramentoPrecos from "@/routes/MonitoramentoPrecos";
import Relatorios from "@/routes/Relatorios";
import ExecucoesRobo from "@/routes/ExecucoesRobo";
import Configuracoes from "@/routes/Configuracoes";
import Usuarios from "@/routes/Usuarios";
import NotFound from "@/routes/NotFound";

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/familias" element={<Familias />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/concorrentes" element={<Concorrentes />} />
          <Route path="/mapeamentos" element={<MapeamentosSku />} />
          <Route path="/monitoramento-precos" element={<MonitoramentoPrecos />} />
          <Route path="/historico" element={<HistoricoPrecos />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/execucoes-robo" element={<ExecucoesRobo />} />
          <Route path="/usuarios" element={<Usuarios />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}
