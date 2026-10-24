import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { guardFeedbackBrowserContext, submitFeedbackAdminSave } from "../scripts/cloudflare/feedback-browser-guard.mjs";

for (const redirect of ["receipt", "receipt-303", "foreign", "wrong-path", "preserve-post"] as const) {
  test(`local fictional admin save guard: ${redirect}`, async ({ browser }) => {
    let writes = 0;
    let receipts = 0;
    let foreignRequests = 0;
    let savedNote = "initial";
    const foreign = createServer((_req, res) => { foreignRequests += 1; res.end("Unexpected"); });
    await new Promise<void>(resolve => { foreign.listen(0, "127.0.0.1", resolve); });
    const foreignAddress = foreign.address() as { port: number };
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
          savedNote = new URLSearchParams(body).get("note") ?? "";
          writes += 1;
          res.writeHead(redirect === "preserve-post" ? 307 : redirect === "receipt-303" ? 303 : 302, {
          Location: redirect === "foreign" ? `http://127.0.0.1:${foreignAddress.port}/receipt` :
            redirect === "wrong-path" ? "/admin/feedback/another?saved=1" : "/admin/feedback/fictional?saved=1",
        });
          res.end();
        });
      } else {
        const receipt = req.url?.includes("saved=1");
        if (receipt) receipts += 1;
        res.setHeader("Content-Type", "text/html");
        // Fictional values are fixed by this test; each GET reads server state.
        res.end(`${receipt ? "<p>Saved.</p>" : ""}<form method="post"><label>Note<input name="note" value="${savedNote}"></label><button>Save</button></form>`);
      }
    });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const address = server.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    const context = await browser.newContext({
      ...test.info().project.use,
      extraHTTPHeaders: { Authorization: "Bearer fictional-save-guard-token" },
      serviceWorkers: "block",
    });
    try {
      await guardFeedbackBrowserContext(context, origin);
      const page = await context.newPage();
      await page.goto(`${origin}/admin/feedback/fictional`);
      await page.getByLabel("Note").fill("first persisted note");
      const save = submitFeedbackAdminSave(page, origin, () => page.getByRole("button", { name: "Save" }).click());
      if (redirect === "receipt" || redirect === "receipt-303") {
        await save;
        await expect(page.getByText("Saved.")).toBeVisible();
        expect(page.url()).toBe(`${origin}/admin/feedback/fictional?saved=1`);
        expect(receipts).toBe(1);
        await page.reload();
        await expect(page.getByLabel("Note")).toHaveValue("first persisted note");
        await page.getByLabel("Note").fill("second persisted note");
        await submitFeedbackAdminSave(page, origin, () => page.getByRole("button", { name: "Save" }).click());
        await page.reload();
        await expect(page.getByText("Saved.")).toBeVisible();
        await expect(page.getByLabel("Note")).toHaveValue("second persisted note");
        expect(savedNote).toBe("second persisted note");
      } else {
        await expect(save).rejects.toThrow("receipt was not validated");
        expect(receipts).toBe(0);
      }
      expect(writes).toBe(redirect === "receipt" || redirect === "receipt-303" ? 2 : 1);
      expect(foreignRequests).toBe(0);
    } finally {
      await context.close();
      await Promise.all([server, foreign].map(instance => new Promise<void>((resolve, reject) => {
        instance.close(error => error ? reject(error) : resolve());
        instance.closeAllConnections();
      })));
    }
  });
}

test("save interception leaves delayed background routes owned by the context", async ({ browser }) => {
  const { closeFeedbackBrowserContext } = await import("../scripts/cloudflare/feedback-browser-guard.mjs");
  let backgroundRequests = 0;
  const requestsById = new Map<string, number>();
  let foreignRequests = 0;
  const foreign = createServer((_req, res) => { foreignRequests += 1; res.end("Unexpected"); });
  await new Promise<void>(resolve => { foreign.listen(0, "127.0.0.1", resolve); });
  const foreignURL = `http://127.0.0.1:${(foreign.address() as { port: number }).port}/blocked`;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/slow")) {
      backgroundRequests += 1;
      requestsById.set(req.url, (requestsById.get(req.url) ?? 0) + 1);
      setTimeout(() => { res.writeHead(302, { Location: foreignURL }); res.end(); }, 150);
    } else if (req.method === "POST") {
      res.writeHead(303, { Location: "/admin/feedback/fictional?saved=1" });
      res.end();
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end('<script>setInterval(()=>fetch("/slow?id="+crypto.randomUUID()).catch(()=>{}),10)</script><form method="post"><button>Save</button></form>');
    }
  });
  await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const context = await browser.newContext({
        ...test.info().project.use,
        extraHTTPHeaders: { Authorization: "Bearer fictional-background-token" },
        serviceWorkers: "block",
      });
      try {
        await guardFeedbackBrowserContext(context, origin);
        const page = await context.newPage();
        await page.goto(`${origin}/admin/feedback/fictional`);
        const before = backgroundRequests;
        await expect.poll(() => backgroundRequests).toBeGreaterThan(before);
        await submitFeedbackAdminSave(page, origin, () => page.getByRole("button", { name: "Save" }).click());
        for (let reload = 0; reload < 3; reload += 1) await page.reload({ waitUntil: "domcontentloaded" });
      } finally {
        await closeFeedbackBrowserContext(context);
      }
    }
    expect(backgroundRequests).toBeGreaterThan(0);
    expect([...requestsById.values()].every(count => count === 1)).toBe(true);
    expect(foreignRequests).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
    foreign.closeAllConnections();
    await new Promise<void>((resolve, reject) => { foreign.close(error => error ? reject(error) : resolve()); });
  }
});

for (const slowPath of ["/slow", "/admin/feedback/fictional"]) {
  test(`save keeps one owner for a pending GET to ${slowPath}`, async ({ browser }) => {
    const { closeFeedbackBrowserContext } = await import("../scripts/cloudflare/feedback-browser-guard.mjs");
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let observed!: () => void;
    const started = new Promise<void>(resolve => { observed = resolve; });
    let posted = false;
    let requests = 0;
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && posted && req.url === slowPath) {
        requests += 1;
        observed();
        await held;
        res.end("fictional response");
      } else if (req.method === "POST") {
        posted = true;
        res.writeHead(303, { Location: "/admin/feedback/fictional?saved=1" });
        res.end();
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(req.url?.includes("saved=1")
          ? `<p>Saved.</p><script>fetch(${JSON.stringify(slowPath)})</script>`
          : '<form method="post"><button>Save</button></form>');
      }
    });
    await new Promise<void>(resolve => { server.listen(0, "127.0.0.1", resolve); });
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const context = await browser.newContext({ ...test.info().project.use, serviceWorkers: "block" });
    try {
      await guardFeedbackBrowserContext(context, origin);
      const page = await context.newPage();
      await page.goto(`${origin}/admin/feedback/fictional`);
      const originalGoto = page.goto.bind(page);
      page.goto = async (...args) => {
        const response = await originalGoto(...args);
        await started;
        return response;
      };
      await submitFeedbackAdminSave(page, origin, () => page.getByRole("button", { name: "Save" }).click());
      release();
      await expect.poll(() => requests).toBe(1);
      await expect(page.getByText("Saved.")).toBeVisible();
    } finally {
      release();
      await closeFeedbackBrowserContext(context);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); });
    }
    expect(requests).toBe(1);
  });
}
