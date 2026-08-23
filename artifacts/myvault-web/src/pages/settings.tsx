import { useTheme } from "next-themes";
import { useAccent } from "@/lib/providers";
import { cn } from "@/lib/utils";
import { BookMarked, Moon, Monitor, Sun } from "lucide-react";
import { PageContainer, PageHeader } from "@/components/page-layout";
import { SyncPreflightPanel } from "@/components/settings/sync-preflight-panel";
import { GoogleDrivePanel } from "@/components/settings/google-drive-panel";

const ACCENT_COLORS = [
  { hex: "#0F8F72", label: "Emerald" },
  { hex: "#C28A16", label: "Gold" },
  { hex: "#2F7EAE", label: "Blue" },
  { hex: "#7C6A46", label: "Olive" },
  { hex: "#A54D3E", label: "Clay" },
  { hex: "#4F7B64", label: "Sage" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { accentColor, setAccentColor } = useAccent();

  return (
    <PageContainer>
      <PageHeader title="Settings" description="Appearance, Google Drive, and backup controls for MyVault." />

      <div className="max-w-4xl space-y-10">
        <section>
          <h2 className="mb-1 text-sm font-semibold text-foreground">Appearance</h2>
          <p className="mb-3 text-xs text-muted-foreground">Choose your preferred theme.</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "light", label: "Light", icon: Sun },
              { value: "dark", label: "Dark", icon: Moon },
              { value: "system", label: "System", icon: Monitor },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                data-testid={`theme-${value}`}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-lg p-3 transition-all",
                  theme === value ? "bg-card text-primary shadow-[0_1px_3px_rgba(15,23,42,0.08)] ring-1 ring-primary/30" : "bg-card/45 hover:bg-card/75",
                )}
              >
                <Icon className={cn("h-5 w-5", theme === value ? "text-primary" : "text-muted-foreground")} />
                <span className={cn("text-xs font-medium", theme === value ? "text-primary" : "text-foreground")}>{label}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-1 text-sm font-semibold text-foreground">Accent Color</h2>
          <p className="mb-3 text-xs text-muted-foreground">Personalise the highlight color throughout the app.</p>
          <div className="flex flex-wrap gap-2">
            {ACCENT_COLORS.map(({ hex, label }) => (
              <button
                key={hex}
                data-testid={`accent-${label.toLowerCase()}`}
                onClick={() => setAccentColor(hex)}
                title={label}
                className={cn(
                  "h-8 w-8 rounded-full border-2 transition-all",
                  accentColor === hex ? "scale-110 border-foreground" : "border-transparent hover:scale-105",
                )}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Current: {accentColor}</p>
        </section>

        <GoogleDrivePanel />

        <SyncPreflightPanel />

        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">About</h2>
          <div className="flex items-center gap-3 rounded-lg bg-card/55 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <BookMarked className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">MyVault Islamic Corpus Web</p>
              <p className="text-xs text-muted-foreground">Companion to the Android MyVault Islamic Corpus.</p>
              <p className="text-xs text-muted-foreground">Version 0.1.0 - UI foundation</p>
            </div>
          </div>
        </section>
      </div>
    </PageContainer>
  );
}
