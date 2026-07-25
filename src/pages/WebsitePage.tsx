import { ClientDirectory } from "@/components/ClientDirectory";
import { ROUTES } from "@/lib/constants";

export function WebsitePage() {
  return (
    <ClientDirectory
      title="Website"
      getRowPath={(id) => ROUTES.websiteClient(id)}
      allowCreate={false}
      showCalendarShortcut={false}
    />
  );
}
