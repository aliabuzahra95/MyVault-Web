import { ThemeProvider, useTheme } from "next-themes";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type Workspace = "personal" | "islamic_corpus";

interface WorkspaceContextType {
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<Workspace>("islamic_corpus");

  const setWorkspace = (ws: Workspace) => {
    setWorkspaceState(ws);
    localStorage.setItem("myvault-workspace", ws);
  };

  return (
    <WorkspaceContext.Provider value={{ workspace, setWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error("useWorkspace must be used within a WorkspaceProvider");
  }
  return context;
}

// Accent Context
interface AccentContextType {
  accentColor: string;
  setAccentColor: (color: string) => void;
}

const AccentContext = createContext<AccentContextType | undefined>(undefined);

export function AccentProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const [accentColor, setAccentColorState] = useState(() => {
    return localStorage.getItem("myvault-accent") || "#0F8F72";
  });

  const setAccentColor = (color: string) => {
    setAccentColorState(color);
    localStorage.setItem("myvault-accent", color);
  };

  useEffect(() => {
    document.documentElement.style.setProperty("--accent-color", accentColor);
    // Convert hex to HSL for tailwind
    let r = 0, g = 0, b = 0;
    if (accentColor.length === 4) {
      r = parseInt(accentColor[1] + accentColor[1], 16);
      g = parseInt(accentColor[2] + accentColor[2], 16);
      b = parseInt(accentColor[3] + accentColor[3], 16);
    } else if (accentColor.length === 7) {
      r = parseInt(accentColor.substring(1, 3), 16);
      g = parseInt(accentColor.substring(3, 5), 16);
      b = parseInt(accentColor.substring(5, 7), 16);
    }
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    const hue = Math.round(h * 360);
    const saturation = Math.round(s * 100);
    const lightness = Math.round(l * 100);
    const themeLightness = resolvedTheme === "dark" ? Math.max(lightness, 58) : lightness;
    const primary = `${hue} ${saturation}% ${themeLightness}%`;
    const accentSaturation = Math.min(Math.max(saturation, 24), 48);
    const accent = resolvedTheme === "dark"
      ? `${hue} ${accentSaturation}% 20%`
      : `${hue} ${accentSaturation}% 93%`;
    const accentForeground = resolvedTheme === "dark"
      ? `${hue} ${Math.min(Math.max(saturation, 28), 58)}% 88%`
      : `${hue} ${Math.min(Math.max(saturation, 30), 62)}% 27%`;
    document.documentElement.style.setProperty("--primary", primary);
    document.documentElement.style.setProperty("--ring", primary);
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-foreground", accentForeground);
    document.documentElement.style.setProperty("--sidebar-primary", primary);
    document.documentElement.style.setProperty("--sidebar-ring", primary);
  }, [accentColor, resolvedTheme]);

  return (
    <AccentContext.Provider value={{ accentColor, setAccentColor }}>
      {children}
    </AccentContext.Provider>
  );
}

export function useAccent() {
  const context = useContext(AccentContext);
  if (context === undefined) {
    throw new Error("useAccent must be used within an AccentProvider");
  }
  return context;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <WorkspaceProvider>
        <AccentProvider>
          {children}
        </AccentProvider>
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
