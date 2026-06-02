import { useState } from "react";
import {
  SettingsNav,
  SettingsSections,
  type SettingsSection,
} from "@/components/settings";

export function SettingsPage() {
  const [section, setSection] = useState<SettingsSection>("profile");

  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <SettingsNav active={section} setActive={setSection} />
      <SettingsSections section={section} />
    </div>
  );
}
