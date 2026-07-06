import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export default function NotFound() {
  const [, navigate] = useLocation();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-64 p-6 text-center">
      <p className="text-6xl font-bold text-muted-foreground/30 mb-4">404</p>
      <h1 className="text-lg font-semibold text-foreground mb-1">Page not found</h1>
      <p className="text-sm text-muted-foreground mb-6">The page you are looking for does not exist.</p>
      <Button onClick={() => navigate("/")} data-testid="back-home-btn">
        <Home className="w-4 h-4 mr-2" /> Back to Home
      </Button>
    </div>
  );
}
