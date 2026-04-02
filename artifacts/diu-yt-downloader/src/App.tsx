import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import YouTubePage from "@/pages/YouTubePage";
import FacebookPage from "@/pages/FacebookPage";
import InstagramPage from "@/pages/InstagramPage";
import TikTokPage from "@/pages/TikTokPage";
import { ThemeProvider } from "@/contexts/ThemeContext";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/youtube" component={YouTubePage} />
      <Route path="/facebook" component={FacebookPage} />
      <Route path="/instagram" component={InstagramPage} />
      <Route path="/tiktok" component={TikTokPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
