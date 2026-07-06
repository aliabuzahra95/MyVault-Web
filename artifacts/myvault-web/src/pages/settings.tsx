import { useTheme } from "next-themes";
import { useWorkspace, useAccent } from "@/lib/providers";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor, BookMarked, User, BookOpen } from "lucide-react";

const ACCENT_COLORS = [
  { hex: "#5B8DEF", label: "Blue" },
  { hex: "#6E7EF4", label: "Indigo" },
  { hex: "#10B981", label: "Emerald" },
  { hex: "#8B5CF6", label: "Violet" },
  { hex: "#F59E0B", label: "Amber" },
  { hex: "#EF4444", label: "Red" },
  { hex: "#EC4899", label: "Pink" },
  { hex: "#06B6D4", label: "Cyan" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { workspace, setWorkspace } = useWorkspace();
  const { accentColor, setAccentColor } = useAccent();

  return (
    <div className="p-6 max-w-xl mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Personalise your vault</p>
      </div>

      {/* Workspace */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-1">Workspace</h2>
        <p className="text-xs text-muted-foreground mb-3">Switch between your personal vault and Islamic corpus study</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            data-testid="workspace-personal"
            onClick={() => setWorkspace("personal")}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
              workspace === "personal"
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/40"
            )}
          >
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", workspace === "personal" ? "bg-primary/20" : "bg-muted")}>
              <User className={cn("w-5 h-5", workspace === "personal" ? "text-primary" : "text-muted-foreground")} />
            </div>
            <div className="text-center">
              <p className={cn("text-sm font-medium", workspace === "personal" ? "text-primary" : "text-foreground")}>Personal</p>
              <p className="text-xs text-muted-foreground">Notes &amp; folders</p>
            </div>
            {workspace === "personal" && (
              <span className="text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded-full">Active</span>
            )}
          </button>
          <button
            data-testid="workspace-islamic"
            onClick={() => setWorkspace("islamic_corpus")}
            className={cn(
              "flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all",
              workspace === "islamic_corpus"
                ? "border-emerald-500 bg-emerald-500/5"
                : "border-border bg-card hover:border-emerald-500/40"
            )}
          >
            <div className={cn("w-10 h-10 rounded-full flex items-center justify-center", workspace === "islamic_corpus" ? "bg-emerald-500/20" : "bg-muted")}>
              <BookOpen className={cn("w-5 h-5", workspace === "islamic_corpus" ? "text-emerald-600" : "text-muted-foreground")} />
            </div>
            <div className="text-center">
              <p className={cn("text-sm font-medium", workspace === "islamic_corpus" ? "text-emerald-700 dark:text-emerald-400" : "text-foreground")}>Islamic Corpus</p>
              <p className="text-xs text-muted-foreground">Quran &amp; Hadith</p>
            </div>
            {workspace === "islamic_corpus" && (
              <span className="text-xs bg-emerald-500 text-white px-2 py-0.5 rounded-full">Active</span>
            )}
          </button>
        </div>
      </section>

      <Separator />

      {/* Appearance */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-1">Appearance</h2>
        <p className="text-xs text-muted-foreground mb-3">Choose your preferred theme</p>
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
                "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                theme === value
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:border-primary/40"
              )}
            >
              <Icon className={cn("w-5 h-5", theme === value ? "text-primary" : "text-muted-foreground")} />
              <span className={cn("text-xs font-medium", theme === value ? "text-primary" : "text-foreground")}>{label}</span>
            </button>
          ))}
        </div>
      </section>

      <Separator />

      {/* Accent color */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-1">Accent Color</h2>
        <p className="text-xs text-muted-foreground mb-3">Personalise the highlight color throughout the app</p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map(({ hex, label }) => (
            <button
              key={hex}
              data-testid={`accent-${label.toLowerCase()}`}
              onClick={() => setAccentColor(hex)}
              title={label}
              className={cn(
                "w-8 h-8 rounded-full border-2 transition-all",
                accentColor === hex ? "border-foreground scale-110" : "border-transparent hover:scale-105"
              )}
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">Current: {accentColor}</p>
      </section>

      <Separator />

      {/* About */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">About</h2>
        <div className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
            <BookMarked className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">MyVault Web</p>
            <p className="text-xs text-muted-foreground">Companion to the MyVault Android app</p>
            <p className="text-xs text-muted-foreground">Version 0.1.0 — Mock data mode</p>
          </div>
        </div>
      </section>
    </div>
  );
}
