import Product from "../models/Product.js";
import Category from "../models/Category.js";
import {
    uploadImage,
    deleteImage,
} from "../services/StorageService.js";

export const createProduct = async (req, res) => {
    try {
        const {
            name,
            slug,
            description,
            price,
            images,
            video,
            category,
            tags,
            stock,
            status,
            printingInfo,
            isFeatured,
        } = req.body;

        if (
            !name ||
            !slug ||
            !description ||
            price === undefined
        ) {
            return res.status(400).json({
                message:
                    "Nome, slug, descrição e preço são obrigatórios.",
            });
        }

        const numericPrice = Number(price);

        if (
            Number.isNaN(numericPrice) ||
            numericPrice < 0
        ) {
            return res.status(400).json({
                message:
                    "O preço informado é inválido.",
            });
        }

        const slugExists = await Product.findOne({
            slug: slug.toLowerCase(),
        });

        if (slugExists) {
            return res.status(409).json({
                message:
                    "Já existe um produto com este slug.",
            });
        }

        /*
         * Resolve categoria.
         *
         * Aceitamos:
         *
         * category: "rpg"
         *
         * OU
         *
         * category: "ObjectId..."
         */

        let categoryId = null;

        if (category) {
            let categoryFound;

            /*
             * Primeiro tentamos procurar pelo slug.
             */
            categoryFound = await Category.findOne({
                slug: String(category).toLowerCase(),
                isActive: true,
            });

            /*
             * Se não encontramos pelo slug,
             * tentamos pelo próprio _id.
             */
            if (
                !categoryFound &&
                String(category).match(
                    /^[0-9a-fA-F]{24}$/
                )
            ) {
                categoryFound =
                    await Category.findOne({
                        _id: category,
                        isActive: true,
                    });
            }

            if (!categoryFound) {
                return res.status(400).json({
                    message:
                        "Categoria informada não existe ou está inativa.",
                });
            }

            categoryId =
                categoryFound._id;
        }

        const product =
            await Product.create({
                seller: req.user.id,

                name,

                slug:
                    slug.toLowerCase(),

                description,

                price:
                    numericPrice,

                images:
                    images || [],

                video:
                    video || null,

                category:
                    categoryId,

                tags:
                    Array.isArray(tags)
                        ? tags.map((tag) =>
                            String(tag).toLowerCase()
                        )
                        : [],

                stock:
                    stock !== undefined
                        ? Number(stock)
                        : 0,

                status:
                    status || "draft",

                printingInfo:
                    printingInfo || {},

                isFeatured:
                    isFeatured === true,
            });

        return res.status(201).json({
            message:
                "Produto criado com sucesso.",

            product,
        });

    } catch (error) {
        console.error(
            "Erro ao criar produto:",
            error
        );

        return res.status(500).json({
            message:
                "Erro interno do servidor.",
        });
    }
};

export const listProducts = async (req, res) => {
    try {
        const {
            search,
            minPrice,
            maxPrice,
            tag,
            category,
            sort,
            isFeatured,
        } = req.query;

        const requestedPage =
            Number(req.query.page) || 1;

        const requestedLimit =
            Number(req.query.limit) || 20;

        const page =
            Math.max(
                requestedPage,
                1
            );

        const limit =
            Math.min(
                Math.max(
                    requestedLimit,
                    1
                ),
                100
            );

        const filter = {
            status: "active",
        };

        /*
 * ============================
 * PRODUTOS EM DESTAQUE
 * ============================
 */

        if (isFeatured !== undefined) {
            if (
                isFeatured !== "true" &&
                isFeatured !== "false"
            ) {
                return res.status(400).json({
                    message:
                        "isFeatured deve ser true ou false.",
                });
            }

            filter.isFeatured =
                isFeatured === "true";
        }

        /*
         * ============================
         * BUSCA POR TEXTO
         * ============================
         */

        if (search) {
            filter.$or = [
                {
                    name: {
                        $regex: search,
                        $options: "i",
                    },
                },

                {
                    description: {
                        $regex: search,
                        $options: "i",
                    },
                },

                {
                    tags: {
                        $regex: search,
                        $options: "i",
                    },
                },
            ];
        }

        /*
         * ============================
         * TAG
         * ============================
         */

        if (tag) {
            filter.tags =
                tag.toLowerCase();
        }

        /*
         * ============================
         * PREÇO
         * ============================
         */

        if (
            minPrice !== undefined ||
            maxPrice !== undefined
        ) {
            filter.price = {};

            if (
                minPrice !== undefined
            ) {
                const min =
                    Number(minPrice);

                if (
                    Number.isNaN(min) ||
                    min < 0
                ) {
                    return res.status(400).json({
                        message:
                            "minPrice inválido.",
                    });
                }

                filter.price.$gte =
                    min;
            }

            if (
                maxPrice !== undefined
            ) {
                const max =
                    Number(maxPrice);

                if (
                    Number.isNaN(max) ||
                    max < 0
                ) {
                    return res.status(400).json({
                        message:
                            "maxPrice inválido.",
                    });
                }

                filter.price.$lte =
                    max;
            }

            if (
                filter.price.$gte !==
                undefined &&
                filter.price.$lte !==
                undefined &&
                filter.price.$gte >
                filter.price.$lte
            ) {
                return res.status(400).json({
                    message:
                        "minPrice não pode ser maior que maxPrice.",
                });
            }
        }

        /*
         * ============================
         * CATEGORIA
         * ============================
         */

        if (category) {
            const categoryFound =
                await Category.findOne({
                    slug:
                        category.toLowerCase(),

                    isActive:
                        true,
                });

            if (!categoryFound) {
                return res.status(404).json({
                    message:
                        "Categoria não encontrada.",
                });
            }

            filter.category =
                categoryFound._id;
        }

        /*
         * ============================
         * ORDENAÇÃO
         * ============================
         */

        let sortOptions = {
            createdAt: -1,
        };

        switch (sort) {
            case "price_asc":
                sortOptions = {
                    price: 1,
                };
                break;

            case "price_desc":
                sortOptions = {
                    price: -1,
                };
                break;

            case "oldest":
                sortOptions = {
                    createdAt: 1,
                };
                break;

            case "popular":
                sortOptions = {
                    views: -1,
                };
                break;

            case "sales":
                sortOptions = {
                    sales: -1,
                };
                break;
        }

        const options = {
            page,

            limit,

            sort:
                sortOptions,

            populate: [
                {
                    path: "seller",

                    select:
                        "name seller.storeName seller.storeSlug seller.isActive",
                },

                {
                    path: "category",

                    select:
                        "name slug description",
                },
            ],
        };

        const result =
            await Product.paginate(
                filter,
                options
            );

        return res.status(200).json({
            products:
                result.docs,

            pagination: {
                totalProducts:
                    result.totalDocs,

                limit:
                    result.limit,

                totalPages:
                    result.totalPages,

                page:
                    result.page,

                hasPrevPage:
                    result.hasPrevPage,

                hasNextPage:
                    result.hasNextPage,

                prevPage:
                    result.prevPage,

                nextPage:
                    result.nextPage,
            },

            filters: {
                search:
                    search || null,

                minPrice:
                    minPrice || null,

                maxPrice:
                    maxPrice || null,

                tag:
                    tag || null,

                category:
                    category || null,

                isFeatured:
                    isFeatured !== undefined
                        ? isFeatured === "true"
                        : null,

                sort:
                    sort || "newest",
            },
        });

    } catch (error) {
        console.error(
            "Erro ao listar produtos:",
            error
        );

        return res.status(500).json({
            message:
                "Erro interno do servidor.",
        });
    }
};

export const listMyProducts = async (req, res) => {
    try {
        const products = await Product.find({
            seller: req.user.id,
        }).sort({ createdAt: -1 });

        return res.status(200).json({
            products,
        });
    } catch (error) {
        console.error("Erro ao listar produtos do vendedor:", error);

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};

export const getProductBySlug = async (req, res) => {
    try {
        const { slug } = req.params;

        const product = await Product.findOneAndUpdate(
            {
                slug: slug.toLowerCase(),
                status: "active",
            },
            {
                $inc: {
                    views: 1,
                },
            },
            {
                new: true,
            }
        ).populate([
            {
                path: "seller",
                select:
                    "name seller.storeName seller.storeSlug seller.description seller.isActive",
            },
            {
                path: "category",
                select: "name slug description",
            },
        ]);

        if (!product) {
            return res.status(404).json({
                message: "Produto não encontrado.",
            });
        }

        return res.status(200).json({
            product,
        });
    } catch (error) {
        console.error("Erro ao buscar produto:", error);

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};

export const getProductById = async (
    req,
    res
) => {
    try {
        const { id } = req.params;

        const product =
            await Product.findById(id)
                .populate({
                    path: "category",
                    select: "name slug description",
                });

        if (!product) {
            return res.status(404).json({
                message:
                    "Produto não encontrado.",
            });
        }

        const isOwner =
            product.seller.toString() ===
            req.user.id;

        const isAdmin =
            req.user.role === "admin";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                message:
                    "Você não tem permissão para acessar este produto.",
            });
        }

        return res.status(200).json({
            product,
        });

    } catch (error) {
        console.error(
            "Erro ao buscar produto por ID:",
            error
        );

        return res.status(500).json({
            message:
                "Erro interno do servidor.",
        });
    }
};

export const updateProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                message: "Produto não encontrado.",
            });
        }

        const isOwner =
            product.seller.toString() === req.user.id;

        const isAdmin =
            req.user.role === "admin";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                message: "Você não tem permissão para editar este produto.",
            });
        }

        const {
            name,
            slug,
            description,
            price,
            images,
            video,
            category,
            tags,
            stock,
            status,
            printingInfo,
            isFeatured,
        } = req.body;

        if (slug && slug.toLowerCase() !== product.slug) {
            const slugExists = await Product.findOne({
                slug: slug.toLowerCase(),
                _id: {
                    $ne: product._id,
                },
            });

            if (slugExists) {
                return res.status(409).json({
                    message: "Já existe um produto com este slug.",
                });
            }
        }

        if (name !== undefined) {
            product.name = name;
        }

        if (slug !== undefined) {
            product.slug = slug.toLowerCase();
        }

        if (description !== undefined) {
            product.description = description;
        }

        if (price !== undefined) {
            product.price = price;
        }

        if (images !== undefined) {
            product.images = images;
        }

        if (video !== undefined) {
            product.video = video;
        }

        if (category !== undefined) {
            /*
             * Permite remover categoria.
             */
            if (
                category === null ||
                category === ""
            ) {
                product.category = null;

            } else {
                let categoryFound =
                    await Category.findOne({
                        slug:
                            String(
                                category
                            ).toLowerCase(),

                        isActive:
                            true,
                    });

                if (
                    !categoryFound &&
                    String(category).match(
                        /^[0-9a-fA-F]{24}$/
                    )
                ) {
                    categoryFound =
                        await Category.findOne({
                            _id:
                                category,

                            isActive:
                                true,
                        });
                }

                if (!categoryFound) {
                    return res.status(400).json({
                        message:
                            "Categoria informada não existe ou está inativa.",
                    });
                }

                product.category =
                    categoryFound._id;
            }
        }

        if (tags !== undefined) {
            product.tags = tags;
        }

        if (stock !== undefined) {
            product.stock = stock;
        }

        if (status !== undefined) {
            product.status = status;
        }

        if (printingInfo !== undefined) {
            product.printingInfo = printingInfo;
        }

        if (isFeatured !== undefined) {
            product.isFeatured = isFeatured === true;
        }

        await product.save();

        return res.status(200).json({
            message: "Produto atualizado com sucesso.",
            product,
        });
    } catch (error) {
        console.error("Erro ao atualizar produto:", error);

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};

export const deleteProduct = async (req, res) => {
    try {
        const { id } = req.params;

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                message: "Produto não encontrado.",
            });
        }

        const isOwner =
            product.seller.toString() === req.user.id;

        const isAdmin =
            req.user.role === "admin";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                message:
                    "Você não tem permissão para excluir este produto.",
            });
        }

        const imageKeys = product.images
            .map((image) => image.key)
            .filter(Boolean);

        if (imageKeys.length > 0) {
            const deleteResults = await Promise.allSettled(
                imageKeys.map((key) => deleteImage(key))
            );

            deleteResults.forEach((result, index) => {
                if (result.status === "rejected") {
                    console.error(
                        `Erro ao excluir imagem ${imageKeys[index]}:`,
                        result.reason
                    );
                }
            });
        }

        await product.deleteOne();

        return res.status(200).json({
            message: "Produto excluído com sucesso.",
        });
    } catch (error) {
        console.error("Erro ao excluir produto:", error);

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};

export const uploadProductImages = async (req, res) => {
    let uploadedImages = [];

    try {
        const { id } = req.params;
        console.log(id);

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                message: "Produto não encontrado.",
            });
        }

        const isOwner =
            product.seller.toString() === req.user.id;

        const isAdmin =
            req.user.role === "admin";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                message:
                    "Você não tem permissão para alterar este produto.",
            });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                message: "Nenhuma imagem enviada.",
            });
        }

        const MAX_IMAGES = 8;

        if (
            product.images.length + req.files.length >
            MAX_IMAGES
        ) {
            return res.status(400).json({
                message: `O produto pode ter no máximo ${MAX_IMAGES} imagens.`,
            });
        }

        uploadedImages = await Promise.all(
            req.files.map((file) =>
                uploadImage(file, "products")
            )
        );

        product.images.push(
            ...uploadedImages.map((image) => ({
                url: image.url,
                key: image.key,
            }))
        );

        if (
            !product.coverImage?.url &&
            uploadedImages.length > 0
        ) {
            product.coverImage = {
                url: uploadedImages[0].url,
                key: uploadedImages[0].key,
            };
        }

        await product.save();

        return res.status(200).json({
            message: "Imagens enviadas com sucesso.",
            images: product.images,
        });
    } catch (error) {
        console.error(
            "Erro ao enviar imagens do produto:",
            error
        );

        // Se o upload foi feito no R2 mas o banco falhou,
        // tentamos remover os arquivos enviados.
        if (uploadedImages.length > 0) {
            await Promise.allSettled(
                uploadedImages.map((image) =>
                    deleteImage(image.key)
                )
            );
        }

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};

export const deleteProductImage = async (req, res) => {
    try {
        const { id } = req.params;
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({
                message: "A key da imagem é obrigatória.",
            });
        }

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                message: "Produto não encontrado.",
            });
        }

        const isOwner =
            product.seller.toString() === req.user.id;

        const isAdmin =
            req.user.role === "admin";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                message:
                    "Você não tem permissão para alterar este produto.",
            });
        }

        const image = product.images.find(
            (image) => image.key === key
        );

        if (!image) {
            return res.status(404).json({
                message: "Imagem não encontrada neste produto.",
            });
        }

        await deleteImage(key);

        product.images = product.images.filter(
            (image) => image.key !== key
        );

        if (product.coverImage?.key === key) {
            if (product.images.length > 0) {
                product.coverImage = {
                    url: product.images[0].url,
                    key: product.images[0].key,
                };
            } else {
                product.coverImage = {
                    url: null,
                    key: null,
                };
            }
        }

        await product.save();

        return res.status(200).json({
            message: "Imagem removida com sucesso.",
            images: product.images,
        });
    } catch (error) {
        console.error(
            "Erro ao remover imagem do produto:",
            error
        );

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};

export const setProductCover = async (req, res) => {
    try {
        const { id } = req.params;
        const { key } = req.body;

        if (!key) {
            return res.status(400).json({
                message: "A key da imagem é obrigatória.",
            });
        }

        const product = await Product.findById(id);

        if (!product) {
            return res.status(404).json({
                message: "Produto não encontrado.",
            });
        }

        const isOwner =
            product.seller.toString() === req.user.id;

        const isAdmin =
            req.user.role === "admin";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                message:
                    "Você não tem permissão para alterar este produto.",
            });
        }

        const image = product.images.find(
            (image) => image.key === key
        );

        if (!image) {
            return res.status(404).json({
                message:
                    "A imagem informada não pertence a este produto.",
            });
        }

        product.coverImage = {
            url: image.url,
            key: image.key,
        };

        await product.save();

        return res.status(200).json({
            message: "Imagem de capa atualizada com sucesso.",
            coverImage: product.coverImage,
        });
    } catch (error) {
        console.error(
            "Erro ao definir capa do produto:",
            error
        );

        return res.status(500).json({
            message: "Erro interno do servidor.",
        });
    }
};