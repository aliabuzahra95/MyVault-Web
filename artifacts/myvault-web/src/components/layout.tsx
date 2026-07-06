import { ReactNode, useState } from "react";
import { Link, useLocation } from "wouter";
import { useWorkspace } from "@/lib/providers";
import { cn } from "@/lib/utils";
import {
  Home, FolderOpen, BookOpen, Search,
  Tag, Network, Settings, Menu, X, ChevronRight,
  BookMarked
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { path: "/", label: "Home", icon: Home },
  { path: "/folders", label: "Folders", icon: FolderOpen },
  { path: "/library", label: "Library", icon: BookOpen },
  { path: "/search", label: "Search", icon: Search },
  { path: "/tags", label: "Tags", icon: Tag },
  { path: "/knowledge-tags", label: "Knowledge", icon: Network },
];

function WorkspaceBadge() {
  const { workspace, setWorkspace } = useWorkspace();
  return (
    <button
      data-testid="workspace-toggle"
      onClick={() => setWorkspace(workspace === "personal" ? "islamic_corpus" : "personal")}
      className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
        workspace === "islamic_corpus"
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-primary/10 text-primary"
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full", workspace === "islamic_corpus" ? "bg-emerald-500" : "bg-primary")} />
      {workspace === "personal" ? "Personal" : "Islamic Corpus"}
    </button>
  );
}

function NavLink({ path, label, Icon }: { path: string; label: string; Icon: React.ElementType }) {
  const [location] = useLocation();
  const active = path === "/" ? location === "/" : location.startsWith(path);
  return (
    <Link
      href={path}
      data-testid={`nav-${label.toLowerCase()}`}
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all group",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
      {label}
      {active && <ChevronRight className="ml-auto w-3 h-3 text-primary/60" />}
    </Link>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r border-border bg-sidebar">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-sidebar-border">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <BookMarked className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-sm text-sidebar-foreground leading-tight">MyVault</span>
            <span className="text-xs text-muted-foreground leading-tight">Your knowledge vault</span>
          </div>
        </div>

        {/* Workspace */}
        <div className="px-4 py-3 border-b border-sidebar-border">
          <p className="text-xs text-muted-foreground mb-1.5 uppercase tracking-wider font-medium">Workspace</p>
          <WorkspaceBadge />
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} path={path} label={label} Icon={Icon} />
          ))}
        </nav>

        {/* Settings */}
        <div className="px-3 py-3 border-t border-sidebar-border">
          <NavLink path="/settings" label="Settings" Icon={Settings} />
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 flex flex-col w-64 h-full bg-sidebar border-r border-border">
            <div className="flex items-center justify-between px-4 py-4 border-b border-sidebar-border">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                  <BookMarked className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-semibold text-sm">MyVault</span>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="px-4 py-3 border-b border-sidebar-border">
              <WorkspaceBadge />
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5" onClick={() => setMobileOpen(false)}>
              {navItems.map(({ path, label, icon: Icon }) => (
                <NavLink key={path} path={path} label={label} Icon={Icon} />
              ))}
              <NavLink path="/settings" label="Settings" Icon={Settings} />
            </nav>
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(true)} data-testid="mobile-menu">
            <Menu className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2">
            <BookMarked className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">MyVault</span>
          </div>
          <WorkspaceBadge />
        </header>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
