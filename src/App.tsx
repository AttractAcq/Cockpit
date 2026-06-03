import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LoginPage } from "@/components/auth/LoginPage";
import { AppShell } from "@/components/shell";
import { CockpitPage } from "@/pages/CockpitPage";
import { PipelinePage } from "@/pages/PipelinePage";
import { ConversationsPage } from "@/pages/ConversationsPage";
import { CampaignsPage } from "@/pages/CampaignsPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { EntityPage } from "@/pages/EntityPage";
import { StudioPage } from "@/pages/StudioPage";
import { OperationsPage } from "@/pages/OperationsPage";
import { MoneyPage } from "@/pages/MoneyPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ROUTES } from "@/lib/constants";

export function App() {
  return (
    <BrowserRouter basename="/aa-cockpit">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to={ROUTES.cockpit} replace />} />
            <Route path={ROUTES.cockpit} element={<CockpitPage />} />
            <Route path={ROUTES.pipeline} element={<PipelinePage />} />
            <Route path={ROUTES.conversations} element={<ConversationsPage />} />
            <Route path="/conversations/:id" element={<ConversationsPage />} />
            <Route path={ROUTES.campaigns} element={<CampaignsPage />} />
            <Route path="/campaigns/:id" element={<CampaignsPage />} />
            <Route path={ROUTES.clients} element={<ClientsPage />} />
            <Route path="/entity/:id" element={<EntityPage />} />
            <Route path={ROUTES.studio} element={<StudioPage />} />
            <Route path={ROUTES.operations} element={<OperationsPage />} />
            <Route path={ROUTES.money} element={<MoneyPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={ROUTES.cockpit} replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
