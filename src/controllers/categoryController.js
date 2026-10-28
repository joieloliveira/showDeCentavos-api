import Category from "../models/Category.js";

export const createCategory = async (req, res) => {
  try {
    const { name, slug, description } = req.body;

    if (!name || !slug) {
      return res.status(400).json({
        message: "Nome e slug são obrigatórios.",
      });
    }

    const categoryExists = await Category.findOne({
      $or: [
        { name },
        { slug: slug.toLowerCase() },
      ],
    });

    if (categoryExists) {
      return res.status(409).json({
        message: "Categoria já cadastrada.",
      });
    }

    const category = await Category.create({
      name,
      slug: slug.toLowerCase(),
      description: description || null,
    });

    return res.status(201).json({
      message: "Categoria criada com sucesso.",
      category,
    });
  } catch (error) {
    console.error("Erro ao criar categoria:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const listCategories = async (req, res) => {
  try {
    const categories = await Category.find({
      isActive: true,
    }).sort({
      name: 1,
    });

    return res.status(200).json({
      categories,
    });
  } catch (error) {
    console.error("Erro ao listar categorias:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const listAdminCategories = async (
  req,
  res
) => {
  try {
    const categories =
      await Category.find().sort({
        name: 1,
      });

    return res.status(200).json({
      categories,
    });
  } catch (error) {
    console.error(
      "Erro ao listar categorias administrativas:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};

export const getCategoryById = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const category =
      await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        message:
          "Categoria não encontrada.",
      });
    }

    return res.status(200).json({
      category,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar categoria:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};

export const updateCategory = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const {
      name,
      slug,
      description,
      isActive,
    } = req.body;

    const category =
      await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        message:
          "Categoria não encontrada.",
      });
    }

    if (
      name &&
      name !== category.name
    ) {
      const nameExists =
        await Category.findOne({
          name,
          _id: {
            $ne: id,
          },
        });

      if (nameExists) {
        return res.status(409).json({
          message:
            "Já existe uma categoria com esse nome.",
        });
      }

      category.name = name;
    }

    if (
      slug &&
      slug.toLowerCase() !==
        category.slug
    ) {
      const normalizedSlug =
        slug.toLowerCase();

      const slugExists =
        await Category.findOne({
          slug: normalizedSlug,
          _id: {
            $ne: id,
          },
        });

      if (slugExists) {
        return res.status(409).json({
          message:
            "Já existe uma categoria com esse slug.",
        });
      }

      category.slug =
        normalizedSlug;
    }

    if (
      description !==
      undefined
    ) {
      category.description =
        description || null;
    }

    if (
      typeof isActive ===
      "boolean"
    ) {
      category.isActive =
        isActive;
    }

    await category.save();

    return res.status(200).json({
      message:
        "Categoria atualizada com sucesso.",
      category,
    });
  } catch (error) {
    console.error(
      "Erro ao atualizar categoria:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};

export const deleteCategory = async (
  req,
  res
) => {
  try {
    const { id } = req.params;

    const category =
      await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        message:
          "Categoria não encontrada.",
      });
    }

    await category.deleteOne();

    return res.status(200).json({
      message:
        "Categoria excluída com sucesso.",
    });
  } catch (error) {
    console.error(
      "Erro ao excluir categoria:",
      error
    );

    return res.status(500).json({
      message:
        "Erro interno do servidor.",
    });
  }
};