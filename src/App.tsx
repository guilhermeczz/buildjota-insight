import { Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "@/routes/Dashboard";
import Familias from "@/routes/Familias";
import Produtos from "@/routes/Produtos";
import Fornecedores from "@/routes/Fornecedores";
import MapeamentosSku from "@/routes/MapeamentosSku";
import HistoricoPrecos from "@/routes/HistoricoPrecos";
import Relatorios from "@/routes/Relatorios";
import ExecucoesRobo from "@/routes/ExecucoesRobo";
import Configuracoes from "@/routes/Configuracoes";
import NotFound from "@/routes/NotFound";

export default function App() {
  return (
    <>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/familias" element={<Familias />} />
          <Route path="/produtos" element={<Produtos />} />
          <Route path="/fornecedores" element={<Fornecedores />} />
          <Route path="/mapeamentos" element={<MapeamentosSku />} />
          <Route path="/historico" element={<HistoricoPrecos />} />
          <Route path="/relatorios" element={<Relatorios />} />
          <Route path="/execucoes-robo" element={<ExecucoesRobo />} />
          <Route path="/configuracoes" element={<Configuracoes />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-right" />
    </>
  );
}
