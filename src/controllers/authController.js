import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { sendPasswordResetEmail } from "../services/EmailService.js";
import User from "../models/User.js";
import { generateToken } from "../config/auth.js";

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validação básica
    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Nome, email e senha são obrigatórios.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message:
          "A senha deve possuir no mínimo 6 caracteres.",
      });
    }

    // Verifica se o email já está cadastrado
    const userExists = await User.findOne({ email });

    if (userExists) {
      return res.status(409).json({
        message: "Este email já está cadastrado.",
      });
    }

    // Criptografa a senha
    const hashedPassword = await bcrypt.hash(password, 10);

    // Cria o usuário
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
    });

    return res.status(201).json({
      message: "Usuário criado com sucesso.",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email e senha são obrigatórios.",
      });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        message: "Email ou senha inválidos.",
      });
    }

    if (!user.password) {
      return res.status(401).json({
        message:
          "Esta conta utiliza login com Google.",
      });
    }

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Email ou senha inválidos.",
      });
    }

    const token = generateToken(user);

    user.lastLogin = new Date();
    await user.save();

    return res.status(200).json({
      message: "Login realizado com sucesso.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Erro ao realizar login:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const forgotPassword = async (req, res) => {
  const successMessage =
    "Se o e-mail estiver cadastrado, você receberá um link de recuperação.";

  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        message: "Informe seu e-mail.",
      });
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(200).json({
        message: successMessage,
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");

    user.passwordResetToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");

    user.passwordResetExpires =
      new Date(Date.now() + 15 * 60 * 1000);

    await user.save();

    const resetUrl =
      `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
      });
    } catch (error) {
      user.passwordResetToken = null;
      user.passwordResetExpires = null;
      await user.save();

      console.error("Erro ao enviar recuperação:", error);

      return res.status(503).json({
        message:
          "Não foi possível enviar o e-mail. Tente novamente mais tarde.",
      });
    }

    return res.status(200).json({
      message: successMessage,
    });
  } catch (error) {
    console.error("Erro na recuperação de senha:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        message: "Token e nova senha são obrigatórios.",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message:
          "A senha deve possuir no mínimo 6 caracteres.",
      });
    }

    const hashedToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: {
        $gt: new Date(),
      },
    }).select(
      "+password +passwordResetToken +passwordResetExpires"
    );

    if (!user) {
      return res.status(400).json({
        message:
          "Token de recuperação inválido ou expirado.",
      });
    }

    user.password = await bcrypt.hash(password, 10);

    user.passwordResetToken = null;
    user.passwordResetExpires = null;

    await user.save();

    return res.status(200).json({
      message: "Senha redefinida com sucesso.",
    });
  } catch (error) {
    console.error("Erro ao redefinir senha:", error);

    return res.status(500).json({
      message: "Erro interno do servidor.",
    });
  }
};

export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        message: "Credencial do Google não informada.",
      });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();

    if (
      !payload?.sub ||
      !payload?.email ||
      !payload?.email_verified
    ) {
      return res.status(401).json({
        message:
          "Não foi possível validar sua conta Google.",
      });
    }

    const email = payload.email
      .trim()
      .toLowerCase();

    let user = await User.findOne({
      email,
    });

    if (user) {
      if (
        user.googleId &&
        user.googleId !== payload.sub
      ) {
        return res.status(409).json({
          message:
            "Este e-mail já está associado a outra conta Google.",
        });
      }

      if (!user.googleId) {
        user.googleId = payload.sub;
      }

      if (
        !user.avatar &&
        payload.picture
      ) {
        user.avatar = payload.picture;
      }

      user.emailVerified = true;
      user.lastLogin = new Date();

      await user.save();
    } else {
      user = await User.create({
        name:
          payload.name ||
          email.split("@")[0],
        email,
        googleId: payload.sub,
        avatar:
          payload.picture || null,
        emailVerified: true,
        lastLogin: new Date(),
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        message:
          "Esta conta está desativada.",
      });
    }

    const token =
      generateToken(user);

    return res.status(200).json({
      message:
        "Login com Google realizado com sucesso.",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error(
      "Erro no login com Google:",
      error
    );

    return res.status(401).json({
      message:
        "Não foi possível autenticar com o Google.",
    });
  }
};