import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

let transporter;
const getTransporter = () => {
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
  });
  return transporter;
};

export const emailConfigured = () => Boolean(env.SMTP_HOST && env.EMAIL_USER && env.EMAIL_PASS);

export const sendMail = async ({ to, subject, html }) => {
  if (!emailConfigured()) throw new Error("Email isn't configured (SMTP_HOST, EMAIL_USER, EMAIL_PASS)");
  await getTransporter().sendMail({ from: `"Smart SAC" <${env.EMAIL_USER}>`, to, subject, html });
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Plain branded email body. `lines` are paragraphs; `code` is shown large when present. */
export const emailTemplate = ({ title, greeting, lines = [], code, footnote }) => `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 560px; margin: 0 auto; color: #142019;">
  <div style="background: #1F5E4B; color: #ffffff; padding: 16px 24px; border-bottom: 4px solid #E9B91C;">
    <strong style="font-size: 18px;">Smart SAC</strong>
  </div>
  <div style="padding: 24px;">
    <h1 style="font-size: 20px; margin: 0 0 16px;">${escapeHtml(title)}</h1>
    ${greeting ? `<p>Hello ${escapeHtml(greeting)},</p>` : ""}
    ${lines.map((line) => `<p style="line-height: 1.5;">${escapeHtml(line)}</p>`).join("")}
    ${
      code
        ? `<p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; background: #EEF1EC; padding: 16px; text-align: center;">${escapeHtml(code)}</p>`
        : ""
    }
    ${footnote ? `<p style="color: #56635c; font-size: 13px;">${escapeHtml(footnote)}</p>` : ""}
  </div>
</div>`;

/**
 * Email a one-time code. Outside production a broken or missing SMTP setup doesn't block sign-up or
 * password reset: the code is written to the server log instead so it can be typed in by hand.
 * Returns whether the email was actually delivered.
 */
export const deliverCode = async ({ purpose, to, name, code, expiresIn }) => {
  try {
    await sendMail({
      to,
      subject: purpose === "verification" ? "Your Smart SAC verification code" : "Your Smart SAC password reset code",
      html: emailTemplate({
        title: purpose === "verification" ? "Confirm your email" : "Reset your password",
        greeting: name,
        lines: [
          purpose === "verification"
            ? "Enter this code to finish creating your Smart SAC account:"
            : "Enter this code to choose a new password:",
        ],
        code,
        footnote: `The code expires in ${expiresIn}. If you didn't ask for it, you can ignore this email.`,
      }),
    });
    return true;
  } catch (error) {
    if (env.isProduction) throw error;
    logger.warn(
      { email: to, purpose, reason: error?.code || error?.message },
      `Couldn't send the ${purpose} email. Development fallback, use this code: ${code}`
    );
    return false;
  }
};
