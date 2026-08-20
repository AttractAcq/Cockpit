// Cockpit v3 Step 1 — Business Context. The persistent "currently selected
// business" this codebase has never had: every page previously resolved
// clientId/businessId independently via route params with zero shared state
// (see docs/COCKPIT_V3_TRANSFORMATION_PLAN.md section 3). This is additive —
// it wraps the existing businesses/clients data, it doesn't replace either
// table or require any migration.
//
// The compatibility layer lives here: business-native systems (Sales) read
// `selectedBusinessId` directly; legacy client_id-scoped systems
// (Opportunity OS, Finance, Marketing, Delivery) read `selectedClientId`,
// resolved from the selected business's linked client. A business with no
// linked client simply resolves `selectedClientId` to null — legacy pages
// stay unaffected until a real client link exists for that business.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { fetchBusinesses } from "./business";
import { resolveSelectedClientId, isStaleSelection } from "./business-context-resolve";
import type { BusinessRow } from "@/types/business";

const STORAGE_KEY = "aa:selectedBusinessId";

interface BusinessContextState {
  businesses: BusinessRow[];
  loading: boolean;
  error: string | null;
  selectedBusinessId: string | null;
  selectedBusiness: BusinessRow | null;
  /** The linked client for the selected business, or null (standalone business, or nothing selected). */
  selectedClientId: string | null;
  setSelectedBusinessId: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<BusinessContextState | undefined>(undefined);

function readStoredId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredId(id: string | null) {
  try {
    if (id) window.localStorage.setItem(STORAGE_KEY, id);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage unavailable (private mode, etc.) — selection just won't persist across reloads.
  }
}

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBusinessId, setSelectedBusinessIdState] = useState<string | null>(readStoredId);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBusinesses(await fetchBusinesses());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // A stored selection that no longer resolves to a real business (deleted,
  // or from a stale/foreign browser profile) is dropped rather than left
  // dangling once the real list has loaded.
  useEffect(() => {
    if (loading) return;
    if (isStaleSelection(businesses, selectedBusinessId)) {
      setSelectedBusinessIdState(null);
      writeStoredId(null);
    }
  }, [loading, businesses, selectedBusinessId]);

  const setSelectedBusinessId = useCallback((id: string | null) => {
    setSelectedBusinessIdState(id);
    writeStoredId(id);
  }, []);

  const selectedBusiness = useMemo(
    () => businesses.find((b) => b.id === selectedBusinessId) ?? null,
    [businesses, selectedBusinessId],
  );

  const value = useMemo<BusinessContextState>(() => ({
    businesses,
    loading,
    error,
    selectedBusinessId,
    selectedBusiness,
    selectedClientId: resolveSelectedClientId(businesses, selectedBusinessId),
    setSelectedBusinessId,
    refresh,
  }), [businesses, loading, error, selectedBusinessId, selectedBusiness, setSelectedBusinessId, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBusinessContext(): BusinessContextState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBusinessContext must be used within a BusinessProvider");
  return ctx;
}
