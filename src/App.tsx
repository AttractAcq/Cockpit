import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { BusinessProvider } from "@/lib/business-context";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LoginPage } from "@/components/auth/LoginPage";
import { AppShell } from "@/components/shell";
import { CockpitPage } from "@/pages/CockpitPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { ClientDetailPage } from "@/pages/ClientDetailPage";
import { BusinessesPage } from "@/pages/BusinessesPage";
import { BusinessDetailPage } from "@/pages/BusinessDetailPage";
import { SalesPage } from "@/pages/SalesPage";
import { SalesLeadDetailPage } from "@/pages/SalesLeadDetailPage";
import { CommsPage } from "@/pages/CommsPage";
import { CommsConversationPage } from "@/pages/CommsConversationPage";
import { OpportunitiesPage } from "@/pages/OpportunitiesPage";
import { AutomationsPage } from "@/pages/AutomationsPage";
import { TeamPage } from "@/pages/TeamPage";
import { KnowledgePage } from "@/pages/KnowledgePage";
import { FinancePage } from "@/pages/FinancePage";
import { OperationsPage } from "@/pages/OperationsPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ROUTES } from "@/lib/constants";

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            element={
              <ProtectedRoute>
                <BusinessProvider>
                  <AppShell />
                </BusinessProvider>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to={ROUTES.cockpit} replace />} />
            <Route path={ROUTES.cockpit} element={<CockpitPage />} />
            <Route path={ROUTES.clients} element={<ClientsPage />} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
            <Route path="/clients/:id/:section" element={<ClientDetailPage />} />
            <Route path={ROUTES.businesses} element={<BusinessesPage />} />
            <Route path="/businesses/:id" element={<BusinessDetailPage />} />
            <Route path={ROUTES.sales} element={<SalesPage />} />
            <Route path="/sales/:id" element={<SalesLeadDetailPage />} />
            <Route path={ROUTES.comms} element={<CommsPage />} />
            <Route path="/comms/:id" element={<CommsConversationPage />} />
            <Route path={ROUTES.opportunities} element={<OpportunitiesPage />} />
            <Route path={ROUTES.automations} element={<AutomationsPage />} />
            <Route path={ROUTES.team} element={<TeamPage />} />
            <Route path={ROUTES.knowledge} element={<KnowledgePage />} />
            <Route path={ROUTES.finance} element={<FinancePage />} />
            <Route path={ROUTES.operations} element={<OperationsPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={ROUTES.cockpit} replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
