import { Router } from "express";

import * as controller from "../controllers/notes.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

export const noteRoutes = Router();

noteRoutes.use(requireAuth);
noteRoutes.get("/", controller.list);
noteRoutes.get("/:id", controller.getOne);
noteRoutes.post("/", controller.create);
noteRoutes.patch("/:id", controller.update);
noteRoutes.delete("/:id", controller.remove);
