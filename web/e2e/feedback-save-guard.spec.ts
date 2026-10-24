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
