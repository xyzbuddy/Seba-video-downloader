import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use("/api", router);

// Serve frontend static files
const frontendPath = path.resolve(__dirname, "../../diu-yt-downloader/dist/public");
app.use(express.static(frontendPath));

// Catch-all route to serve index.html for client-side routing
app.use((req, res, next) => {
  if (req.method === "GET") {
    res.sendFile(path.join(frontendPath, "index.html"));
  } else {
    next();
  }
});

export default app;
