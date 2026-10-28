import SiteSettings from "../models/SiteSettings.js";

import {
    uploadImage,
} from "../services/StorageService.js";

/*
 * ==========================
 * BUSCAR CONFIGURAÇÕES DO SITE
 * ==========================
 */
export const getSiteSettings =
    async (req, res) => {
        try {
            let settings =
                await SiteSettings.findOne();

            /*
             * Na primeira execução ainda
             * não existirá configuração.
             *
             * Criamos automaticamente
             * o documento global.
             */
            if (!settings) {
                settings =
                    await SiteSettings.create({});
            }

            return res.status(200).json(
                settings
            );
        } catch (error) {
            console.error(
                "Erro ao buscar configurações do site:",
                error
            );

            return res.status(500).json({
                message:
                    "Não foi possível carregar as configurações do site.",
            });
        }
    };

/*
* ==========================
* ATUALIZAR LOGOS DO SITE
* ==========================
*/
export const updateSiteLogos =
    async (req, res) => {
        try {
            let settings =
                await SiteSettings.findOne();

            if (!settings) {
                settings =
                    await SiteSettings.create({});
            }

            const desktop =
                req.files?.desktop?.[0];

            const tablet =
                req.files?.tablet?.[0];

            const mobile =
                req.files?.mobile?.[0];

            if (
                !desktop &&
                !tablet &&
                !mobile
            ) {
                return res.status(400).json({
                    message:
                        "Envie pelo menos uma imagem de logo.",
                });
            }

            if (desktop) {
                const uploaded =
                    await uploadImage(
                        desktop,
                        "site/branding"
                    );

                settings.branding.logo.desktop =
                    uploaded.url;
            }

            if (tablet) {
                const uploaded =
                    await uploadImage(
                        tablet,
                        "site/branding"
                    );

                settings.branding.logo.tablet =
                    uploaded.url;
            }

            if (mobile) {
                const uploaded =
                    await uploadImage(
                        mobile,
                        "site/branding"
                    );

                settings.branding.logo.mobile =
                    uploaded.url;
            }

            await settings.save();

            return res.status(200).json({
                message:
                    "Logo do site atualizada com sucesso.",
                branding:
                    settings.branding,
            });
        } catch (error) {
            console.error(
                "Erro ao atualizar logo do site:",
                error
            );

            return res.status(500).json({
                message:
                    "Não foi possível atualizar a logo do site.",
            });
        }
    };

/*
* ==========================
* ATUALIZAR BANNERS DO SITE
* ==========================
*/
export const updateSiteBanners =
    async (req, res) => {
        try {
            let settings =
                await SiteSettings.findOne();

            if (!settings) {
                settings =
                    await SiteSettings.create({});
            }

            const desktop =
                req.files?.desktop?.[0];

            const tablet =
                req.files?.tablet?.[0];

            const mobile =
                req.files?.mobile?.[0];

            if (
                !desktop &&
                !tablet &&
                !mobile
            ) {
                return res.status(400).json({
                    message:
                        "Envie pelo menos uma imagem de banner.",
                });
            }

            if (desktop) {
                const uploaded =
                    await uploadImage(
                        desktop,
                        "site/banners"
                    );

                settings.banners.home.desktop =
                    uploaded.url;
            }

            if (tablet) {
                const uploaded =
                    await uploadImage(
                        tablet,
                        "site/banners"
                    );

                settings.banners.home.tablet =
                    uploaded.url;
            }

            if (mobile) {
                const uploaded =
                    await uploadImage(
                        mobile,
                        "site/banners"
                    );

                settings.banners.home.mobile =
                    uploaded.url;
            }

            await settings.save();

            return res.status(200).json({
                message:
                    "Banner do site atualizado com sucesso.",
                banners:
                    settings.banners,
            });
        } catch (error) {
            console.error(
                "Erro ao atualizar banner do site:",
                error
            );

            return res.status(500).json({
                message:
                    "Não foi possível atualizar o banner do site.",
            });
        }
    };

/*
* ==========================
* ATUALIZAR TEXTOS DO SITE
* ==========================
*/
export const updateSiteContent =
    async (req, res) => {
        try {
            const {
                about,
                rules,
            } = req.body;

            if (
                typeof about !== "string" &&
                typeof rules !== "string"
            ) {
                return res.status(400).json({
                    message:
                        "Informe pelo menos um texto para atualizar.",
                });
            }

            let settings =
                await SiteSettings.findOne();

            if (!settings) {
                settings =
                    await SiteSettings.create({});
            }

            /*
             * Atualiza somente os campos
             * enviados na requisição.
             */
            if (typeof about === "string") {
                settings.content.about =
                    about.trim();
            }

            if (typeof rules === "string") {
                settings.content.rules =
                    rules.trim();
            }

            await settings.save();

            return res.status(200).json({
                message:
                    "Conteúdo do site atualizado com sucesso.",
                content:
                    settings.content,
            });
        } catch (error) {
            console.error(
                "Erro ao atualizar conteúdo do site:",
                error
            );

            return res.status(500).json({
                message:
                    "Não foi possível atualizar o conteúdo do site.",
            });
        }
    };