import React, { type ReactNode } from "react";

export default function DiscoveryShell({
  children,
  active,
  demo = false,
}: {
  children: ReactNode;
  active: "scout" | "journey" | "mentor";
  demo?: boolean;
}) {
  const links = demo
    ? [
        {
          id: "journey",
          href: "/dev/community-ui?view=journey",
          label: "My journey",
        },
        { id: "scout", href: "/dev/community-ui", label: "Discover people" },
        {
          id: "mentor",
          href: "/dev/community-ui?view=mentor",
          label: "Mentor review",
        },
      ]
    : [
        {
          id: active,
          href: "#main-content",
          label:
            active === "scout"
              ? "Discover people"
              : active === "mentor"
                ? "Mentor review"
                : "My journey",
        },
      ];
  return (
    <div className="discovery-app">
      <a className="discovery-skip" href="#main-content">
        Skip to content
      </a>
      <header className="discovery-header">
        <a
          className="discovery-brand"
          href={demo ? "/dev/community-ui" : "/dashboard"}
          aria-label="TTV home"
        >
          ttv<span>community</span>
        </a>
        <nav aria-label="Community navigation">
          {links.map((link) => (
            <a
              key={link.id}
              href={link.href}
              aria-current={active === link.id ? "page" : undefined}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <a className="discovery-back" href="/dashboard">
          Dashboard ↗
        </a>
      </header>
      {demo && (
        <div className="discovery-demo" role="note">
          <strong>Interactive demo</strong>
          <span>
            Fictional profiles and sample responses. Changes stay in this page.
          </span>
        </div>
      )}
      <main id="main-content" className="discovery-main">
        {children}
      </main>
      <footer className="discovery-footer">
        <span>People, with the work to tell their story.</span>
        <span>TEMBO TECH VENTURES</span>
      </footer>
    </div>
  );
}
