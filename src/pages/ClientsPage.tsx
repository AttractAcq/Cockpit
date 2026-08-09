import { ClientDirectory } from "@/components/ClientDirectory";
import { ROUTES } from "@/lib/constants";

export function ClientsPage() {
  return (
    <ClientDirectory
      title="Delivery"
      getRowPath={(id) => ROUTES.client(id)}
      allowCreate
      showCalendarShortcut
    />
  );
}
