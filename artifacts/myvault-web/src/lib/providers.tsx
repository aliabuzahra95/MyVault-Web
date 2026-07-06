import { ThemeProvider } from "next-themes";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";

// Workspace Context
type Workspace = "personal" | "islamic_corpus";

interface WorkspaceContextType {
  workspace: Workspace;
  setWorkspace: (workspace: Workspace) => void;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspaceState] = useState<Workspace>(() => {
    const saved = localStorage.getItem("myvault-workspace");
    return (saved as Workspace) || "personal";
  });

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
  const [accentColor, setAccentColorState] = useState(() => {
    return localStorage.getItem("myvault-accent") || "#5B8DEF";
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
    document.documentElement.style.setProperty("--primary", `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`);
  }, [accentColor]);

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
