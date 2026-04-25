const nodemailer = require("nodemailer");

// Utility: simple HTML escape to prevent injection into email bodies
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// In-memory rate limiting (resets per cold start, good enough for serverless)
const ipRequestMap = new Map();
const RATE_LIMIT = 12;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

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
  // CORS headers
  const allowedOrigins = ["https://hawktok.com", "https://www.hawktok.com"];
  const origin = req.headers.origin;

  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, msg: "Method not allowed." });
  }

  // Rate limiting
  const clientIp = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(clientIp)) {
    return res.status(429).json({ success: false, msg: "Too many submissions. Please try again later." });
  }

  const { name, email, message } = req.body || {};

  // Validation
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

  const mailOptions = {
    from: `"${safeName}" <${process.env.EMAIL_USER}>`,
    replyTo: safeEmail,
    to: process.env.EMAIL_USER,
    subject: `[WEBSITE FORM] New Contact Request from ${safeName}`,
    text: `Website contact form submission\nFrom: ${safeName} <${safeEmail}>\n\n${message}`,
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
  };

  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      logger: false,
      debug: false,
    });

    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return res.status(200).json({ success: true, msg: "Message sent successfully!" });
  } catch (error) {
    console.error("Error sending email:", error?.message || error);
    return res.status(500).json({ success: false, msg: "Failed to send message." });
  }
};
