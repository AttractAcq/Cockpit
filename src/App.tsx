import { lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { BusinessProvider } from "@/lib/business-context";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LoginPage } from "@/components/auth/LoginPage";
import { AppShell } from "@/components/shell";
import { ROUTES } from "@/lib/constants";

// Every protected page is its own chunk, loaded on first navigation to it
// (AppShell wraps <Outlet/> in <Suspense>, so LeftRail/TopBar stay visible
// across the load) rather than all 18 pages shipping in the initial bundle.
// LoginPage stays a static import above -- it's the one page every signed-out
// visitor needs immediately, so lazy-loading it would only add a round trip.
const CockpitPage = lazy(() => import("@/pages/CockpitPage").then((m) => ({ default: m.CockpitPage })));
const ClientsPage = lazy(() => import("@/pages/ClientsPage").then((m) => ({ default: m.ClientsPage })));
const ClientDetailPage = lazy(() => import("@/pages/ClientDetailPage").then((m) => ({ default: m.ClientDetailPage })));
const BusinessesPage = lazy(() => import("@/pages/BusinessesPage").then((m) => ({ default: m.BusinessesPage })));
const BusinessDetailPage = lazy(() => import("@/pages/BusinessDetailPage").then((m) => ({ default: m.BusinessDetailPage })));
const SalesPage = lazy(() => import("@/pages/SalesPage").then((m) => ({ default: m.SalesPage })));
const SalesLeadDetailPage = lazy(() => import("@/pages/SalesLeadDetailPage").then((m) => ({ default: m.SalesLeadDetailPage })));
const CommsPage = lazy(() => import("@/pages/CommsPage").then((m) => ({ default: m.CommsPage })));
const CommsConversationPage = lazy(() => import("@/pages/CommsConversationPage").then((m) => ({ default: m.CommsConversationPage })));
const OpportunitiesPage = lazy(() => import("@/pages/OpportunitiesPage").then((m) => ({ default: m.OpportunitiesPage })));
const AutomationsPage = lazy(() => import("@/pages/AutomationsPage").then((m) => ({ default: m.AutomationsPage })));
const TeamPage = lazy(() => import("@/pages/TeamPage").then((m) => ({ default: m.TeamPage })));
const KnowledgePage = lazy(() => import("@/pages/KnowledgePage").then((m) => ({ default: m.KnowledgePage })));
const FinancePage = lazy(() => import("@/pages/FinancePage").then((m) => ({ default: m.FinancePage })));
const MasterAIPage = lazy(() => import("@/pages/MasterAIPage").then((m) => ({ default: m.MasterAIPage })));
const MarketingPage = lazy(() => import("@/pages/MarketingPage").then((m) => ({ default: m.MarketingPage })));
const OperationsPage = lazy(() => import("@/pages/OperationsPage").then((m) => ({ default: m.OperationsPage })));
const SettingsPage = lazy(() => import("@/pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));

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
            <Route path={ROUTES.masterAi} element={<MasterAIPage />} />
            <Route path={ROUTES.marketing} element={<MarketingPage />} />
            <Route path={ROUTES.operations} element={<OperationsPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={ROUTES.cockpit} replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
