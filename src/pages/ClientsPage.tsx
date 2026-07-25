import { ClientDirectory } from "@/components/ClientDirectory";
import { ROUTES } from "@/lib/constants";

export function ClientsPage() {
  return (
    <ClientDirectory
      title="Marketing"
      getRowPath={(id) => ROUTES.client(id)}
      allowCreate
      showCalendarShortcut
    />
  );
}
