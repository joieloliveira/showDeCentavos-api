import express from "express";

import {
    getSiteSettings,
    updateSiteLogos,
    updateSiteBanners,
    updateSiteContent,
} from "../controllers/siteSettingsController.js";

import upload from "../middlewares/upload.js";
import auth from "../middlewares/auth.js";
import isAdmin from "../middlewares/isAdmin.js";

const router = express.Router();

/*
 * ==========================
 * CONFIGURAÇÕES PÚBLICAS
 * ==========================
 */
router.get(
    "/",
    getSiteSettings
);

/*
 * ==========================
 * CONFIGURAÇÕES ADMIN
 * ==========================
 */
router.put(
    "/logo",
    auth,
    isAdmin,
    upload.fields([
        {
            name: "desktop",
            maxCount: 1,
        },
        {
            name: "tablet",
            maxCount: 1,
        },
        {
            name: "mobile",
            maxCount: 1,
        },
    ]),
    updateSiteLogos
);

router.put(
    "/banner",
    auth,
    isAdmin,
    upload.fields([
        {
            name: "desktop",
            maxCount: 1,
        },
        {
            name: "tablet",
            maxCount: 1,
        },
        {
            name: "mobile",
            maxCount: 1,
        },
    ]),
    updateSiteBanners
);

router.put(
    "/content",
    auth,
    isAdmin,
    updateSiteContent
);

export default router;