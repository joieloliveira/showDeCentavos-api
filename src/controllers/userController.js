import User from "../models/User.js";

export const becomeSeller = async (req, res) => {
  try {
    const { storeName, storeSlug, description } = req.body;

    if (!storeName || !storeSlug) {
      return res.status(400).json({
        message: "Nome da loja e slug são obrigatórios.",
      });
    }

    const slugExists = await User.findOne({
      "seller.storeSlug": storeSlug.toLowerCase(),
      _id: { $ne: req.user.id },
    });

    if (slugExists) {
      return res.status(409).json({
        message: "Este endereço de loja já está sendo utilizado.",
      });
    }

    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    user.role = "seller";

    user.seller = {
      storeName,
      storeSlug: storeSlug.toLowerCase(),
      description: description || null,
      isActive: true,
    };

    await user.save();

    return res.status(200).json({
      message: "Conta de vendedor criada com sucesso.",
      seller: {
        userId: user._id,
        storeName: user.seller.storeName,
        storeSlug: user.seller.storeSlug,
        description: user.seller.description,
        isActive: user.seller.isActive,
      },
    });
  } catch (error) {
    console.error("Erro ao criar conta de vendedor:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const listAdminUsers = async (req, res) => {
  try {
    const requestedPage = Number(req.query.page) || 1;
    const requestedLimit = Number(req.query.limit) || 20;

    const page = Math.max(requestedPage, 1);
    const limit = Math.min(Math.max(requestedLimit, 1), 50);
    const skip = (page - 1) * limit;

    const filter = {};

    if (req.query.role) {
      filter.role = req.query.role;
    }

    if (req.query.isActive !== undefined) {
      filter.isActive = req.query.isActive === "true";
    }

    if (req.query.search) {
      const search = req.query.search.trim();

      filter.$or = [
        {
          name: {
            $regex: search,
            $options: "i",
          },
        },
        {
          email: {
            $regex: search,
            $options: "i",
          },
        },
        {
          "seller.storeName": {
            $regex: search,
            $options: "i",
          },
        },
      ];
    }

    const [users, totalUsers] = await Promise.all([
      User.find(filter)
        .select(
          [
            "name",
            "email",
            "role",
            "avatar",
            "phone",
            "cpf",
            "seller.storeName",
            "seller.storeSlug",
            "seller.description",
            "seller.banner",
            "seller.isActive",
            "seller.mercadoPago.connected",
            "seller.mercadoPago.userId",
            "isActive",
            "emailVerified",
            "lastLogin",
            "createdAt",
            "updatedAt",
          ].join(" ")
        )
        .sort({
          createdAt: -1,
        })
        .skip(skip)
        .limit(limit),

      User.countDocuments(filter),
    ]);

    return res.status(200).json({
      users,

      pagination: {
        totalUsers,
        page,
        limit,
        totalPages: Math.ceil(totalUsers / limit),
      },
    });
  } catch (error) {
    console.error(
      "Erro ao listar usuários administrativos:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const getAdminUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select(
      [
        "name",
        "email",
        "role",
        "avatar",
        "phone",
        "cpf",
        "seller.storeName",
        "seller.storeSlug",
        "seller.description",
        "seller.banner",
        "seller.isActive",
        "seller.mercadoPago.connected",
        "seller.mercadoPago.userId",
        "isActive",
        "emailVerified",
        "lastLogin",
        "createdAt",
        "updatedAt",
      ].join(" ")
    );

    if (!user) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    return res.status(200).json({
      user,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar usuário administrativo:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const updateAdminUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        message: "isActive deve ser true ou false.",
      });
    }

    if (id === req.user.id) {
      return res.status(400).json({
        message:
          "Você não pode desativar sua própria conta administrativa.",
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    user.isActive = isActive;

    await user.save();

    return res.status(200).json({
      message: isActive
        ? "Usuário ativado com sucesso."
        : "Usuário desativado com sucesso.",

      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
      },
    });
  } catch (error) {
    console.error(
      "Erro ao alterar status do usuário:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const updateAdminUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const allowedRoles = [
      "customer",
      "seller",
      "admin",
    ];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Role inválida.",
      });
    }

    if (id === req.user.id) {
      return res.status(400).json({
        message:
          "Você não pode alterar a role da sua própria conta.",
      });
    }

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        message: "Usuário não encontrado.",
      });
    }

    user.role = role;

    /*
     * Se deixou de ser seller,
     * desativamos apenas a loja.
     *
     * Não apagamos os dados de seller.
     */
    if (
      role !== "seller" &&
      user.seller
    ) {
      user.seller.isActive = false;
    }

    await user.save();

    return res.status(200).json({
      message:
        "Role do usuário atualizada com sucesso.",

      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,

        seller: {
          storeName:
            user.seller?.storeName || null,

          storeSlug:
            user.seller?.storeSlug || null,

          isActive:
            user.seller?.isActive || false,
        },
      },
    });
  } catch (error) {
    console.error(
      "Erro ao alterar role do usuário:",
      error
    );

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};