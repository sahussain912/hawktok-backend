const nodemailer = require("nodemailer");

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ipRequestMap = new Map();
const RATE_LIMIT = 12;
const WINDOW_MS = 60 * 60 * 1000;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipRequestMap.get(ip);
  if (!entry || now - entry.startTime > WINDOW_MS) {
    ipRequestMap.set(ip, { count: 1, startTime: now });
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  return false;
}

module.exports = async (req, res) => {
  const allowedOrigins = ["https://hawktok.com", "https://www.hawktok.com"];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, msg: "Method not allowed." });
  }

  const clientIp = req.headers["x-forwarded-for"] || "unknown";
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, msg: "Too many submissions. Please try again later." });
  }

  const { name, email, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, msg: "Missing required fields." });
  }
  if (typeof name !== "string" || name.length > 100) {
    return res.status(400).json({ success: false, msg: "Invalid name." });
  }
  if (typeof message !== "string" || message.length > 5000) {
    return res.status(400).json({ success: false, msg: "Message too long." });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(String(email))) {
    return res.status(400).json({ success: false, msg: "Invalid email address." });
  }

  const safeName = escapeHtml(name.trim());
  const safeEmail = escapeHtml(String(email).trim());
  const safeMessage = escapeHtml(message.trim()).replace(/\n/g, "<br>");

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: `"HawkTok Contact" <${process.env.GMAIL_USER}>`,
      replyTo: safeEmail,
      to: process.env.GMAIL_USER,
      subject: `[WEBSITE FORM] New Contact Request from ${safeName}`,
      text: `From: ${safeName} <${safeEmail}>\n\n${message}`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>body{font-family:Arial,sans-serif;color:#333;}</style>
</head>
<body>
  <div style="max-width:600px;margin:0 auto;">
    <div style="background:linear-gradient(90deg,#FF0050 0%,#FF1A66 14%,#EE2A7B 28%,#69C9D0 42%);padding:20px;color:#fff;">
      <h2 style="margin:0;">Website Contact Form</h2>
      <div style="font-size:12px;margin-top:6px;">Received: ${new Date().toUTCString()}</div>
    </div>
    <div style="background:#f9f9f9;padding:20px;">
      <p><strong>Name:</strong> ${safeName}</p>
      <p><strong>Email:</strong> <a href="mailto:${safeEmail}">${safeEmail}</a></p>
      <hr />
      <div style="white-space:pre-wrap">${safeMessage}</div>
    </div>
  </div>
</body>
</html>`,
    });

    return res.status(200).json({ success: true, msg: "Message sent successfully!" });
  } catch (err) {
    console.error("Error:", err?.message || err);
    return res.status(500).json({ success: false, msg: "Failed to send message." });
  }
};
