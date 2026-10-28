import User from "../models/User.js";
import Product from "../models/Product.js";
import {
  uploadImage,
  deleteImage,
} from "../services/StorageService.js";

import {
  MIN_SELLER_PRODUCTS,
} from "../config/marketplace.js";

export const getSellerBySlug = async (req, res) => {
  try {
    const { slug } = req.params;

    const seller = await User.findOne({
      "seller.storeSlug": slug,
      "seller.isActive": true,
    }).select(
      "name seller.storeName seller.storeSlug seller.description seller.banner seller.isActive"
    );

    if (!seller) {
      return res.status(404).json({
        message: "Loja não encontrada.",
      });
    }

    const products = await Product.find({
      seller: seller._id,
      status: "active",
    })
      .sort({
        createdAt: -1,
      })
      .select(
        "name slug price coverImage images stock reservedStock status"
      );

    const productCount = products.length;

    const storeAvailable =
      productCount >= MIN_SELLER_PRODUCTS;

    if (!storeAvailable) {
      return res.status(403).json({
        message:
          "Esta loja ainda não atingiu a quantidade mínima de produtos para ficar disponível.",
        productCount,
        requiredProducts:
          MIN_SELLER_PRODUCTS,
      });
    }

    return res.status(200).json({
      seller: {
        id: seller._id,
        storeName:
          seller.seller.storeName,
        storeSlug:
          seller.seller.storeSlug,
        description:
          seller.seller.description,
        banner:
          seller.seller.banner,
      },

      store: {
        productCount,
        minimumProducts:
          MIN_SELLER_PRODUCTS,
      },

      products,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar loja:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};

export const updateSellerProfile = async (req, res) => {
  try {
    const { storeName, description, banner } = req.body;

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    if (user.role !== "seller" && user.role !== "admin") {
      return res.status(403).json({
        message: "Usuário não possui uma conta de vendedor.",
      });
    }

    if (!user.seller) {
      return res.status(400).json({
        message: "Perfil de vendedor não encontrado.",
      });
    }

    if (storeName !== undefined) {
      user.seller.storeName = storeName;
    }

    if (description !== undefined) {
      user.seller.description = description;
    }

    if (banner !== undefined) {
      user.seller.banner = banner;
    }

    await user.save();

    return res.status(200).json({
      message: "Perfil do vendedor atualizado com sucesso.",

      seller: {
        storeName: user.seller.storeName,
        storeSlug: user.seller.storeSlug,
        description: user.seller.description,
        banner: user.seller.banner,
        isActive: user.seller.isActive,
      },
    });
  } catch (error) {
    console.error("Erro ao atualizar vendedor:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const uploadSellerBanner = async (
  req,
  res
) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: "Nenhuma imagem enviada.",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    // Guarda a key antiga antes de fazer upload
    const oldBannerKey =
      user.seller.banner?.key || null;

    // Faz upload do novo banner
    const uploadedImage = await uploadImage(
      req.file,
      "sellers/banners"
    );

    // Atualiza o usuário
    user.seller.banner = {
      url: uploadedImage.url,
      key: uploadedImage.key,
    };

    await user.save();

    // Remove o banner antigo do R2
    if (oldBannerKey) {
      try {
        await deleteImage(oldBannerKey);
      } catch (deleteError) {
        console.error(
          "Não foi possível apagar o banner antigo:",
          deleteError
        );
      }
    }

    return res.status(200).json({
      message: "Banner atualizado com sucesso.",

      banner: user.seller.banner,
    });
  } catch (error) {
    console.error(
      "Erro ao enviar banner:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};