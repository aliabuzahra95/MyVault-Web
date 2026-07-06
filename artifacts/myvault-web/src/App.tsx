import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppProviders } from "@/lib/providers";
import Layout from "@/components/layout";
import HomePage from "@/pages/home";
import FoldersPage from "@/pages/folders";
import FolderDetailPage from "@/pages/folder-detail";
import NoteDetailPage from "@/pages/note-detail";
import LibraryPage from "@/pages/library";
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

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/folders" component={FoldersPage} />
        <Route path="/folders/:id" component={FolderDetailPage} />
        <Route path="/notes/:id" component={NoteDetailPage} />
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
