import express, { type Express } from "express";
import cors from "cors";
import pinoHttpPkg from "pino-http";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import type { IncomingMessage, ServerResponse } from "http";

const app: Express = express();
const pinoHttp = pinoHttpPkg as unknown as any;

app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req: IncomingMessage) {
        return { id: (req as any).id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res: ServerResponse) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors({ exposedHeaders: ["Content-Disposition"] }));

app.use("/api", router);
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Serve the built website when it's next to the server (single-service deploys
// such as Railway). Vercel/Vite dev serve the frontend themselves.
const webDist = path.resolve(__dirname, "..", "..", "diu-yt-downloader", "dist");
if (fs.existsSync(path.join(webDist, "index.html"))) {
  app.use(express.static(webDist, { index: false, maxAge: "1h" }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

export default app;
