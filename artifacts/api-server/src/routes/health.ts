import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Used by Render/Railway health checks and to confirm the server is up.
router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
