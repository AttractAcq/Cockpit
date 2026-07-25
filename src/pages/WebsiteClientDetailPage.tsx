import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Icon, EmptyState } from "@/components/primitives";
import { fetchClient } from "@/lib/api";
import type { Client } from "@/types/client";
import { ROUTES } from "@/lib/constants";

export function WebsiteClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchClient(id)
      .then((c) => {
        if (!c) setError("Client not found");
        else setClient(c);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading)
    return (
      <div className="flex-1 flex items-center justify-center text-paper-3 text-xs">
        Loading…
      </div>
    );
  if (error)
    return (
      <div className="flex-1 flex items-center justify-center text-neg text-xs">
        {error}
      </div>
    );
  if (!client) return null;

  return (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <div className="border-b border-line px-4 py-3 flex flex-col gap-2.5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(ROUTES.website)}
            className="text-paper-3 hover:text-paper transition-colors"
          >
            <Icon name="arrow-left" size={14} />
          </button>
          <h1 className="text-sm font-medium text-paper">{client.name}</h1>
        </div>

        {/* Button bar — single tab, only entry point for this surface today. */}
        <div className="flex items-center gap-1 flex-wrap">
          <button className="px-2.5 py-1 text-2xs rounded-md font-medium bg-teal/15 text-teal">
            Landing Pages
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex-1 flex items-center justify-center p-8">
          <EmptyState icon="external" title="Landing Pages" body="No landing pages yet." />
        </div>
      </div>
    </div>
  );
}
