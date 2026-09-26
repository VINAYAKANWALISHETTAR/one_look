import { Router } from "express";

import * as controller from "../controllers/tasks.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const taskRoutes = Router();

taskRoutes.use(requireAuth);
taskRoutes.get("/", controller.list);
taskRoutes.get("/:id", controller.getOne);
taskRoutes.post("/", controller.create);
taskRoutes.patch("/:id", controller.update);
taskRoutes.delete("/:id", controller.remove);
