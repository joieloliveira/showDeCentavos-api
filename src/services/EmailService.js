import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT || 587) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

export const sendPasswordResetEmail = async ({
  to,
  name,
  resetUrl,
}) => {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "Recuperação de senha",
    text: `Olá, ${name}!

Recebemos uma solicitação para redefinir sua senha.

Acesse o link abaixo:
${resetUrl}

Este link expira em 15 minutos.

Se você não solicitou a recuperação, ignore este e-mail.`,
  });
};