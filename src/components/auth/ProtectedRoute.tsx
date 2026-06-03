// src/components/auth/ProtectedRoute.tsx
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

// Staff-only gate for the cockpit. Clients are sent to the portal app.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, role, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center bg-ink text-paper-2">Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (role === "client") {
    window.location.href = import.meta.env.VITE_PORTAL_URL ?? "/login";
    return null;
  }
  if (!role) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink flex-col gap-3">
        <div className="text-warn font-medium">No role assigned</div>
        <div className="text-paper-3 text-sm text-center max-w-sm">
          Your account isn't mapped to a staff role yet. Ask an admin to run{" "}
          <code className="text-teal">scripts/create-staff-admin.sql</code> with your email.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

// Optional per-workspace role guard
export function RequireRole({ roles, children }: { roles: string[]; children: ReactNode }) {
  const { role } = useAuth();
  if (role && roles.includes(role)) return <>{children}</>;
  return <div className="p-8 text-paper-3">You don't have access to this workspace.</div>;
}
