import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProviders } from "@/lib/providers";
import Layout from "@/components/layout";
import HomePage from "@/pages/home";
import CoursesPage from "@/pages/courses";
import CourseDetailPage from "@/pages/course-detail";
import FoldersPage from "@/pages/folders";
import FolderDetailPage from "@/pages/folder-detail";
import NoteDetailPage from "@/pages/note-detail";
import LibraryPage from "@/pages/library";
import LibraryDocumentPage from "@/pages/library-document";
import QuranPage, { QuranReaderPage } from "@/pages/quran";
import SearchPage from "@/pages/search";
import TagsPage from "@/pages/tags";
import KnowledgeTagsPage from "@/pages/knowledge-tags";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30000 },
  },
});

function RestoreRedirect() {
  const [, navigate] = useLocation();
  useEffect(() => navigate("/settings", { replace: true }), [navigate]);
  return null;
}

function WorkspaceDataQuerySync() {
  const client = useQueryClient();

  useEffect(() => {
    const resetWorkspaceQueries = () => {
      void client.resetQueries();
    };

    window.addEventListener("myvault-restored-corpus-changed", resetWorkspaceQueries);
    return () => window.removeEventListener("myvault-restored-corpus-changed", resetWorkspaceQueries);
  }, [client]);

  return null;
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/restore" component={RestoreRedirect} />
        <Route path="/courses" component={CoursesPage} />
        <Route path="/study" component={FoldersPage} />
        <Route path="/study/:id" component={FolderDetailPage} />
        <Route path="/quran/:surah/:ayah" component={QuranReaderPage} />
        <Route path="/quran" component={QuranPage} />
        <Route path="/folders" component={FoldersPage} />
        <Route path="/folders/:id" component={FolderDetailPage} />
        <Route path="/courses/:courseId/notes/:id" component={NoteDetailPage} />
        <Route path="/courses/:courseId" component={CourseDetailPage} />
        <Route path="/notes/:id" component={NoteDetailPage} />
        <Route path="/library/document/:id" component={LibraryDocumentPage} />
        <Route path="/library" component={LibraryPage} />
        <Route path="/search" component={SearchPage} />
        <Route path="/tags" component={TagsPage} />
        <Route path="/knowledge-tags" component={KnowledgeTagsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceDataQuerySync />
      <AppProviders>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AppProviders>
    </QueryClientProvider>
  );
}

export default App;
