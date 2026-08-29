import type { ElementType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Cloud,
  Home,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { hasGoogleClientId } from "@/lib/googleDrive/identity";
import { KnowledgeNavigator } from "@/components/navigation/knowledge-navigator";
import { useGoogleDriveProfile } from "@/hooks/useGoogleDriveProfile";
import { useGoogleDriveConnection } from "@/hooks/useGoogleDriveConnection";

const applicationNavItems = [
  { path: "/", label: "Dashboard", icon: Home },
  { path: "/settings", label: "Settings", icon: Settings },
];

function NavLink({ path, label, Icon, onSelect }: { path: string; label: string; Icon: ElementType; onSelect?: () => void }) {
  const [location] = useLocation();
  const active = path === "/" ? location === "/" : location.startsWith(path);
  return (
    <Link
      href={path}
      onClick={onSelect}
      data-testid={`nav-${label.toLowerCase()}`}
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent/55 hover:text-sidebar-foreground",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-foreground")} />
      {label}
    </Link>
  );
}

function profileInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "MV";
}

function ProfileHeader() {
  const profile = useGoogleDriveProfile();
  const displayName = profile?.displayName?.trim()
    || profile?.emailAddress?.split("@")[0]?.trim()
    || "Your account";

  return (
    <div className="flex h-[76px] shrink-0 items-center gap-3 px-5">
      <Avatar className="h-9 w-9 ring-1 ring-sidebar-border/70">
        {profile?.photoLink ? <AvatarImage src={profile.photoLink} alt="" referrerPolicy="no-referrer" /> : null}
        <AvatarFallback className="bg-sidebar-primary/10 text-[11px] font-semibold text-sidebar-primary">
          {profileInitials(displayName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <span className="block truncate text-[13px] font-semibold leading-5 text-sidebar-foreground">{displayName}</span>
        <span className="block truncate text-[9px] font-semibold uppercase text-muted-foreground">Islamic Corpus</span>
      </div>
    </div>
  );
}

function SidebarContent({ closeMobile, collapseDesktop }: { closeMobile?: () => void; collapseDesktop?: () => void }) {
  const googleConfigured = hasGoogleClientId();
  const drive = useGoogleDriveConnection();
  const driveConnected = Boolean(drive.token && drive.accountId);
  const driveChecking = drive.status === "initializing" || drive.status === "renewing";
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  function closeSearch() {
    setSearchActive(false);
    setSearchQuery("");
  }

  useEffect(() => {
    if (!searchActive) return;
    searchInputRef.current?.focus();

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-sidebar-search-region]")) closeSearch();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [searchActive]);

  return (
    <>
      <ProfileHeader />

      <div className="flex min-h-0 flex-1 flex-col" data-sidebar-search-region>
        <nav className="shrink-0 space-y-0.5 px-3 pb-3">
          <div className="mb-1 px-2 text-[9.5px] font-bold uppercase text-sidebar-foreground/55">Application</div>
          <NavLink
            path={applicationNavItems[0].path}
            label={applicationNavItems[0].label}
            Icon={applicationNavItems[0].icon}
            onSelect={() => { closeSearch(); closeMobile?.(); }}
          />

          {searchActive ? (
            <div className="flex h-9 items-center gap-2 rounded-md bg-sidebar-accent px-2.5 ring-1 ring-sidebar-ring/20">
              <Search className="h-4 w-4 shrink-0 text-sidebar-primary" />
              <input
                ref={searchInputRef}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") closeSearch();
                }}
                aria-label="Search MyVault"
                placeholder="Search MyVault"
                className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-sidebar-foreground outline-none placeholder:text-muted-foreground"
                data-testid="sidebar-search-input"
              />
              <button
                type="button"
                onClick={closeSearch}
                aria-label="Close search"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchActive(true)}
              className="group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent/55 hover:text-sidebar-foreground"
              data-testid="nav-search"
            >
              <Search className="h-4 w-4 shrink-0 group-hover:text-sidebar-foreground" />
              Search
            </button>
          )}

          <NavLink
            path={applicationNavItems[1].path}
            label={applicationNavItems[1].label}
            Icon={applicationNavItems[1].icon}
            onSelect={() => { closeSearch(); closeMobile?.(); }}
          />
        </nav>

        <KnowledgeNavigator
          closeMobile={closeMobile}
          searchActive={searchActive}
          searchQuery={searchQuery}
          closeSearch={closeSearch}
        />
      </div>

      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="flex h-10 items-center gap-2 rounded-md bg-sidebar-accent/45 px-2.5 text-muted-foreground">
          <Link href="/settings" className="flex min-w-0 flex-1 items-center gap-2" onClick={closeMobile}>
            <Cloud className="h-4 w-4 shrink-0" />
            <span className="truncate text-[11px] font-medium">
              Drive {driveConnected ? "connected" : driveChecking ? "checking" : googleConfigured ? "not connected" : "needs setup"}
            </span>
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", driveConnected ? "bg-emerald-600" : "bg-muted-foreground/55")} />
          </Link>
          <Link href="/settings" aria-label="Account and settings" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground" onClick={closeMobile}>
            <UserRound className="h-4 w-4" />
          </Link>
          {collapseDesktop ? (
            <button
              type="button"
              aria-label="Collapse navigation"
              title="Collapse navigation"
              onClick={collapseDesktop}
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-card hover:text-foreground md:flex"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => localStorage.getItem("myvault-sidebar-collapsed") === "true");

  function setSidebarCollapsed(collapsed: boolean) {
    setDesktopCollapsed(collapsed);
    localStorage.setItem("myvault-sidebar-collapsed", String(collapsed));
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        className={cn(
          "relative hidden shrink-0 overflow-hidden bg-sidebar md:flex",
          desktopCollapsed ? "w-0 opacity-0" : "w-[284px] border-r border-sidebar-border/45 opacity-100",
        )}
      >
        <div className="flex h-full w-[284px] shrink-0 flex-col">
          <SidebarContent collapseDesktop={() => setSidebarCollapsed(true)} />
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-slate-950/40" onClick={() => setMobileOpen(false)} />
          <aside className="relative z-50 flex h-full w-[292px] flex-col border-r border-sidebar-border/65 bg-sidebar shadow-xl">
            <button className="absolute right-3 top-3 rounded-md p-2 text-slate-500" onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </button>
            <SidebarContent closeMobile={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {desktopCollapsed ? (
          <button
            type="button"
            aria-label="Open navigation"
            title="Open navigation"
            onClick={() => setSidebarCollapsed(false)}
            className="absolute left-3 top-3 z-30 hidden h-9 w-9 items-center justify-center rounded-md bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground md:flex"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        ) : null}
        <header className="flex h-14 shrink-0 items-center justify-between bg-background px-4 md:hidden">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMobileOpen(true)} data-testid="mobile-menu">
            <Menu className="h-5 w-5" />
          </Button>
          <span className="text-sm font-bold">MyVault</span>
          <span className="text-[10px] font-semibold uppercase text-slate-400">Islamic Corpus</span>
        </header>

        <main className="relative isolate min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
          <div className="min-h-full w-full bg-background">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
