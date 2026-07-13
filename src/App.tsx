import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { LoginPage } from "@/components/auth/LoginPage";
import { AppShell } from "@/components/shell";
import { CockpitPage } from "@/pages/CockpitPage";
import { ClientsPage } from "@/pages/ClientsPage";
import { ClientDetailPage } from "@/pages/ClientDetailPage";
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
                <AppShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to={ROUTES.cockpit} replace />} />
            <Route path={ROUTES.cockpit} element={<CockpitPage />} />
            <Route path={ROUTES.clients} element={<ClientsPage />} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
            <Route path="/clients/:id/:section" element={<ClientDetailPage />} />
            <Route path={ROUTES.operations} element={<OperationsPage />} />
            <Route path={ROUTES.settings} element={<SettingsPage />} />
            <Route path="*" element={<Navigate to={ROUTES.cockpit} replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
