import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";
import { getDb } from "../db";
import { mailLogs } from "../db/schema";
import { newId } from "../lib/ids";

let transporter: Transporter | null = null;

function transport(): Transporter | null {
  if (!config.smtp.host) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends mail through SMTP when configured, and always records the message in
 * `mail_logs` so the UI can show an outbox during development.
 */
export async function sendMail(input: MailInput): Promise<{ delivered: boolean; transport: string }> {
  const tx = transport();
  let delivered = false;
  let error: string | null = null;
  if (tx) {
    try {
      await tx.sendMail({ from: config.smtp.from, to: input.to, subject: input.subject, text: input.text, html: input.html });
      delivered = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
  const kind = tx ? (delivered ? "smtp" : "smtp-error") : "console";
  if (!delivered) {
    console.log(`\n[mail:${kind}] to=${input.to} subject="${input.subject}"\n${input.text}\n`);
  }
  await getDb().insert(mailLogs).values({
    id: newId(),
    to: input.to,
    subject: input.subject,
    body: input.text,
    transport: kind,
    error,
    createdAt: new Date(),
  });
  return { delivered, transport: kind };
}
