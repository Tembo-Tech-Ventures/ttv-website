// Component-only browser harness. API tests use explicit mocked responses; never live auth evidence.
import React from "react";
import { createRoot } from "react-dom/client";
import CommunityApp from "../../src/components/community/CommunityApp";
import CommunityDemo from "../../src/components/community/CommunityDemo";
// oxlint-disable-next-line import/no-unassigned-import -- Real app styles for component browser tests.
import "../../src/styles/global.css";
// oxlint-disable-next-line import/no-unassigned-import -- Real component stylesheet.
import "../../src/styles/discovery.css";

const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById("root")!).render(
  params.get("api") === "mock" ? (
    <>
      <p>Component harness · Mock API responses · No live authentication</p>
      <CommunityApp
        view={
          params.get("view") === "journey"
            ? "journey"
            : params.get("view") === "mentor"
              ? "mentor"
              : "scout"
        }
      />
    </>
  ) : (
    <CommunityDemo
      view={params.get("view") ?? "scout"}
      fail={params.get("fail") === "1"}
    />
  ),
);
