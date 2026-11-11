"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AppLink } from "@/components/app-link";

const links = [
  { href: "/", label: "Overview" },
  { href: "/craft/", label: "Craft & Assemble" },
  { href: "/experiment/", label: "Experiment & Simulate" },
];

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const [online, setOnline] = useState(true);
  const currentPath = pathname === "/" || pathname.endsWith("/") ? pathname : `${pathname}/`;

  useEffect(() => {
    let active = true;
    let currentCheck: AbortController | undefined;
    const updateStatus = () => {
      currentCheck?.abort();
      if (!navigator.onLine) {
        setOnline(false);
        return;
      }

      const controller = new AbortController();
      currentCheck = controller;
      const timeout = window.setTimeout(() => controller.abort(), 3000);
      fetch("/", { method: "HEAD", cache: "no-store", signal: controller.signal })
        .then((response) => {
          if (active && currentCheck === controller) setOnline(response.ok);
        })
        .catch(() => {
          if (active && currentCheck === controller) setOnline(false);
        })
        .finally(() => window.clearTimeout(timeout));
    };

    updateStatus();
    const interval = window.setInterval(updateStatus, 30000);
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
        console.error("Service worker registration failed.", error);
      });
    }

    return () => {
      active = false;
      currentCheck?.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  return (
    <>
      <header className="topbar">
        <AppLink className="brand" href="/" aria-label="FusionCraft Hub home">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>fusioncraft<span className="brand-light">/hub</span></span>
        </AppLink>
        <nav className="main-nav" aria-label="Main navigation">
          {links.map((link) => (
            <AppLink
              aria-current={currentPath === link.href ? "page" : undefined}
              className={currentPath === link.href ? "nav-link active" : "nav-link"}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </AppLink>
          ))}
        </nav>
        <div className="connection-status">
          <span className={online ? "status-dot" : "status-dot offline"} />
          {online ? "Ready to create" : "Offline mode"}
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <span>FusionCraft Hub <span className="footer-muted">· Your work stays yours.</span></span>
        <span className="footer-local"><span className="status-dot" /> Local-first by design</span>
      </footer>
    </>
  );
}
