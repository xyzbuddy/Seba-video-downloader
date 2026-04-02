import { Router, type IRouter } from "express";
import healthRouter from "./health";
import youtubeRouter from "./youtube";
import mediaRouter from "./media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(youtubeRouter);
router.use(mediaRouter);

export default router;
