import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { guardFeedbackBrowserContext, submitFeedbackAdminSave } from "../scripts/cloudflare/feedback-browser-guard.mjs";

for (const redirect of ["receipt", "foreign", "wrong-path", "preserve-post"] as const) {
  test(`local fictional admin save guard: ${redirect}`, async ({ browser }) => {
    let writes = 0;
    let receipts = 0;
    let foreignRequests = 0;
    const foreign = createServer((_req, res) => { foreignRequests += 1; res.end("Unexpected"); });
    await new Promise<void>(resolve => { foreign.listen(0, "127.0.0.1", resolve); });
    const foreignAddress = foreign.address() as { port: number };
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        writes += 1;
        res.writeHead(redirect === "preserve-post" ? 307 : 302, {
          Location: redirect === "foreign" ? `http://127.0.0.1:${foreignAddress.port}/receipt` :
            redirect === "wrong-path" ? "/admin/feedback/another?saved=1" : "/admin/feedback/fictional?saved=1",
        });
        res.end();
      } else if (req.url?.includes("saved=1")) {
        receipts += 1;
        res.end("<p>Saved.</p>");
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end('<form method="post"><button>Save</button></form>');
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
      const save = submitFeedbackAdminSave(page, origin, () => page.getByRole("button", { name: "Save" }).click());
      if (redirect === "receipt") {
        await save;
        await expect(page.getByText("Saved.")).toBeVisible();
        expect(page.url()).toBe(`${origin}/admin/feedback/fictional?saved=1`);
        expect(receipts).toBe(1);
      } else {
        await expect(save).rejects.toThrow("receipt was not validated");
        expect(receipts).toBe(0);
      }
      expect(writes).toBe(1);
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
