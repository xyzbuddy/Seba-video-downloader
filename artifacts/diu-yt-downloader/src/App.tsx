import { Link, Route, Router, Switch } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { ToolPage } from "@/pages/ToolPage";
import { PLATFORMS, PLATFORM_META } from "@/lib/platforms";

function NotFound() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 pt-20 sm:px-6">
      <h1 className="text-5xl font-bold">This page doesn't exist.</h1>
      <p className="mt-4 text-lg text-ink-soft">The address may be mistyped, or the page was moved.</p>
      <Link href="/" className="mt-8 inline-flex min-h-12 items-center rounded-2xl bg-brand px-6 font-bold text-brand-ink">
        Go to the downloader
      </Link>
    </main>
  );
}

export default function App() {
  return (
    <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10 focus:rounded-lg focus:bg-action focus:px-4 focus:py-2 focus:font-bold focus:text-action-ink"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh flex-col">
        <SiteHeader />
        <div className="flex-1">
          <Switch>
            <Route path="/">{() => <ToolPage key="home" />}</Route>
            {PLATFORMS.map((p) => (
              <Route key={p} path={PLATFORM_META[p].path}>
                {() => <ToolPage key={p} platform={p} />}
              </Route>
            ))}
            <Route>
              <NotFound />
            </Route>
          </Switch>
        </div>
        <SiteFooter />
      </div>
    </Router>
  );
}
