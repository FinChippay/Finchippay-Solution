/**
 * src/services/emailRenderer.js
 *
 * Handlebars-based email renderer for all transactional email templates.
 * Produces both HTML (with tracking pixel) and plain-text versions.
 *
 * Templates:
 *   welcome, payment_received, payment_sent, escrow_released,
 *   stream_claimed, scheduled_txn_executed, price_alert,
 *   security_alert, email_verification
 */

"use strict";

const Handlebars = require("handlebars");

// ─── Helpers ──────────────────────────────────────────────────────────────────

Handlebars.registerHelper("eq", (a, b) => a === b);
Handlebars.registerHelper("truncate", (str, len) => {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "…" : str;
});

// ─── Shared layout ────────────────────────────────────────────────────────────

const APP_NAME = "Finchippay";
const BRAND_COLOR = "#6C63FF";
const BASE_URL = process.env.APP_BASE_URL || "https://finchippay.io";

/**
 * Wraps inner HTML in a responsive email shell with branded header/footer.
 *
 * @param {object} opts
 * @param {string} opts.title        - Email heading
 * @param {string} opts.preheader    - Short preview text shown in inbox list
 * @param {string} opts.accentColor  - Header gradient top colour (hex)
 * @param {string} opts.body         - Inner HTML content (injected verbatim)
 * @param {string} opts.unsubscribeUrl
 * @param {string} [opts.trackingPixelUrl]
 * @returns {string} complete HTML email
 */
function layout(opts) {
  const {
    title,
    preheader = "",
    accentColor = BRAND_COLOR,
    body,
    unsubscribeUrl = "#",
    trackingPixelUrl = "",
  } = opts;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>${title} – ${APP_NAME}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0; mso-table-rspace: 0; }
    img { -ms-interpolation-mode: bicubic; border: 0; }
    body { margin: 0; padding: 0; background: #f4f4f7; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, ${accentColor}, #764ba2); padding: 32px 24px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
    .body-card { background: #ffffff; padding: 32px 40px; border-left: 1px solid #e0e0e0; border-right: 1px solid #e0e0e0; }
    .footer { background: #f4f4f7; padding: 24px; text-align: center; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0; border-top: none; }
    .footer p { margin: 4px 0; font-size: 12px; color: #9e9e9e; }
    .footer a { color: #9e9e9e; }
    .data-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .data-table th, .data-table td { text-align: left; padding: 10px 12px; font-size: 14px; }
    .data-table th { background: #f9f9fc; color: #555; font-weight: 600; width: 40%; }
    .data-table td { color: #222; }
    .data-table tr { border-bottom: 1px solid #ebebeb; }
    .btn { display: inline-block; background: ${accentColor}; color: #ffffff !important; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; margin: 20px 0; }
    .amount-badge { font-size: 28px; font-weight: 700; color: ${accentColor}; margin: 12px 0; }
    .alert-box { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 16px; margin: 16px 0; border-radius: 4px; font-size: 14px; }
    .alert-box.danger { background: #fdecea; border-color: #e53935; }
    p { color: #444; font-size: 15px; line-height: 1.6; }
    @media only screen and (max-width: 620px) {
      .wrapper { width: 100% !important; }
      .body-card { padding: 24px 16px !important; }
    }
  </style>
</head>
<body>
  <span style="display:none;font-size:1px;color:#f4f4f7;max-height:0;overflow:hidden;">${preheader}</span>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td align="center" style="padding: 24px 0;">
      <table class="wrapper" cellpadding="0" cellspacing="0" role="presentation">
        <tr><td>
          <div class="header"><h1>${title}</h1></div>
          <div class="body-card">${body}</div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
            <p><a href="${unsubscribeUrl}">Unsubscribe</a> &middot; <a href="${BASE_URL}/privacy">Privacy Policy</a></p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  ${trackingPixelUrl ? `<img src="${trackingPixelUrl}" width="1" height="1" alt="" style="display:none;" />` : ""}
</body>
</html>`;
}

// ─── Template definitions ─────────────────────────────────────────────────────

const RAW_TEMPLATES = {
  welcome: {
    subject: "Welcome to {{appName}}!",
    preheader: "Your account is ready. Get started now.",
    accentColor: "#6C63FF",
    html: `
      <p>Hi there! 👋</p>
      <p>Welcome to <strong>{{appName}}</strong> — the fast, secure way to send and receive Stellar payments.</p>
      <p>Your account is connected to:</p>
      <table class="data-table">
        <tr><th>Public Key</th><td style="word-break:break-all;">{{publicKey}}</td></tr>
        {{#if username}}<tr><th>Username</th><td>{{username}}</td></tr>{{/if}}
      </table>
      <p>Start by exploring your dashboard or setting up your notification preferences.</p>
      <a href="{{dashboardUrl}}" class="btn">Go to Dashboard</a>
    `,
    text: "Welcome to {{appName}}!\n\nYour account is ready.\nPublic Key: {{publicKey}}\n{{#if username}}Username: {{username}}\n{{/if}}\nDashboard: {{dashboardUrl}}",
  },

  payment_received: {
    subject: "You received {{amount}} {{asset}}",
    preheader: "A payment has landed in your account.",
    accentColor: "#6C63FF",
    html: `
      <p>You have received a new payment!</p>
      <div class="amount-badge">{{amount}} {{asset}}</div>
      <table class="data-table">
        <tr><th>From</th><td style="word-break:break-all;">{{sender}}</td></tr>
        <tr><th>To</th><td style="word-break:break-all;">{{recipient}}</td></tr>
        {{#if memo}}<tr><th>Memo</th><td>{{memo}}</td></tr>{{/if}}
        <tr><th>Time</th><td>{{timestamp}}</td></tr>
        {{#if txHash}}<tr><th>Transaction</th><td style="word-break:break-all;font-size:12px;">{{txHash}}</td></tr>{{/if}}
      </table>
      {{#if viewUrl}}<a href="{{viewUrl}}" class="btn">View Transaction</a>{{/if}}
    `,
    text: "Payment Received\n\nAmount: {{amount}} {{asset}}\nFrom: {{sender}}\nTo: {{recipient}}\n{{#if memo}}Memo: {{memo}}\n{{/if}}Time: {{timestamp}}\n{{#if txHash}}TX: {{txHash}}\n{{/if}}",
  },

  payment_sent: {
    subject: "Payment sent: {{amount}} {{asset}}",
    preheader: "Your payment has been submitted to the Stellar network.",
    accentColor: "#43aa8b",
    html: `
      <p>Your payment has been sent successfully.</p>
      <div class="amount-badge">{{amount}} {{asset}}</div>
      <table class="data-table">
        <tr><th>To</th><td style="word-break:break-all;">{{recipient}}</td></tr>
        <tr><th>From</th><td style="word-break:break-all;">{{sender}}</td></tr>
        {{#if memo}}<tr><th>Memo</th><td>{{memo}}</td></tr>{{/if}}
        <tr><th>Time</th><td>{{timestamp}}</td></tr>
        {{#if txHash}}<tr><th>Transaction</th><td style="word-break:break-all;font-size:12px;">{{txHash}}</td></tr>{{/if}}
      </table>
      {{#if viewUrl}}<a href="{{viewUrl}}" class="btn">View Transaction</a>{{/if}}
    `,
    text: "Payment Sent\n\nAmount: {{amount}} {{asset}}\nTo: {{recipient}}\nFrom: {{sender}}\n{{#if memo}}Memo: {{memo}}\n{{/if}}Time: {{timestamp}}\n{{#if txHash}}TX: {{txHash}}\n{{/if}}",
  },

  escrow_released: {
    subject: "Escrow released: {{amount}} {{asset}}",
    preheader: "Your escrow funds have been released.",
    accentColor: "#43e97b",
    html: `
      <p>Escrow funds have been released!</p>
      <div class="amount-badge">{{amount}} {{asset}}</div>
      <table class="data-table">
        <tr><th>Released To</th><td style="word-break:break-all;">{{recipient}}</td></tr>
        <tr><th>Released By</th><td style="word-break:break-all;">{{sender}}</td></tr>
        <tr><th>Time</th><td>{{timestamp}}</td></tr>
        {{#if txHash}}<tr><th>Transaction</th><td style="word-break:break-all;font-size:12px;">{{txHash}}</td></tr>{{/if}}
      </table>
      {{#if viewUrl}}<a href="{{viewUrl}}" class="btn">View Transaction</a>{{/if}}
    `,
    text: "Escrow Released\n\nAmount: {{amount}} {{asset}}\nReleased To: {{recipient}}\nReleased By: {{sender}}\nTime: {{timestamp}}\n{{#if txHash}}TX: {{txHash}}\n{{/if}}",
  },

  stream_claimed: {
    subject: "Payment stream claimed: {{amount}} {{asset}}",
    preheader: "Streaming payment has been claimed.",
    accentColor: "#f5576c",
    html: `
      <p>A payment stream has been claimed.</p>
      <div class="amount-badge">{{amount}} {{asset}}</div>
      <table class="data-table">
        <tr><th>Claimed By</th><td style="word-break:break-all;">{{recipient}}</td></tr>
        <tr><th>From</th><td style="word-break:break-all;">{{sender}}</td></tr>
        {{#if memo}}<tr><th>Memo</th><td>{{memo}}</td></tr>{{/if}}
        <tr><th>Time</th><td>{{timestamp}}</td></tr>
        {{#if txHash}}<tr><th>Transaction</th><td style="word-break:break-all;font-size:12px;">{{txHash}}</td></tr>{{/if}}
      </table>
    `,
    text: "Stream Claimed\n\nAmount: {{amount}} {{asset}}\nClaimed By: {{recipient}}\nFrom: {{sender}}\n{{#if memo}}Memo: {{memo}}\n{{/if}}Time: {{timestamp}}\n",
  },

  scheduled_txn_executed: {
    subject: "Scheduled transaction executed: {{amount}} {{asset}}",
    preheader: "Your scheduled payment has been automatically executed.",
    accentColor: "#4facfe",
    html: `
      <p>Your scheduled transaction has been executed successfully.</p>
      <div class="amount-badge">{{amount}} {{asset}}</div>
      <table class="data-table">
        <tr><th>To</th><td style="word-break:break-all;">{{recipient}}</td></tr>
        <tr><th>From</th><td style="word-break:break-all;">{{sender}}</td></tr>
        {{#if scheduledAt}}<tr><th>Scheduled At</th><td>{{scheduledAt}}</td></tr>{{/if}}
        <tr><th>Executed At</th><td>{{timestamp}}</td></tr>
        {{#if txHash}}<tr><th>Transaction</th><td style="word-break:break-all;font-size:12px;">{{txHash}}</td></tr>{{/if}}
      </table>
      {{#if viewUrl}}<a href="{{viewUrl}}" class="btn">View Transaction</a>{{/if}}
    `,
    text: "Scheduled Transaction Executed\n\nAmount: {{amount}} {{asset}}\nTo: {{recipient}}\nFrom: {{sender}}\nExecuted At: {{timestamp}}\n{{#if txHash}}TX: {{txHash}}\n{{/if}}",
  },

  price_alert: {
    subject: "Price alert: {{asset}} is {{direction}} {{threshold}}",
    preheader: "Your price alert has been triggered.",
    accentColor: "#fa709a",
    html: `
      <p>Your price alert has been triggered!</p>
      <table class="data-table">
        <tr><th>Asset</th><td>{{asset}}</td></tr>
        <tr><th>Current Price</th><td>{{currentPrice}}</td></tr>
        <tr><th>Your Threshold</th><td>{{direction}} {{threshold}}</td></tr>
        <tr><th>Time</th><td>{{timestamp}}</td></tr>
      </table>
      {{#if viewUrl}}<a href="{{viewUrl}}" class="btn">View Market</a>{{/if}}
    `,
    text: "Price Alert\n\nAsset: {{asset}}\nCurrent Price: {{currentPrice}}\nThreshold: {{direction}} {{threshold}}\nTime: {{timestamp}}\n",
  },

  security_alert: {
    subject: "Security alert: {{alertType}}",
    preheader: "Important security notice for your account.",
    accentColor: "#e53935",
    html: `
      <div class="alert-box danger">
        <strong>⚠️ Security Notice</strong><br />
        This email was sent because a security-relevant action occurred on your account.
      </div>
      <table class="data-table">
        <tr><th>Event</th><td>{{alertType}}</td></tr>
        <tr><th>IP Address</th><td>{{#if ipAddress}}{{ipAddress}}{{else}}N/A{{/if}}</td></tr>
        <tr><th>Time</th><td>{{timestamp}}</td></tr>
      </table>
      <p>If you did not perform this action, please secure your account immediately.</p>
      {{#if viewUrl}}<a href="{{viewUrl}}" class="btn">Review Account</a>{{/if}}
    `,
    text: "Security Alert: {{alertType}}\n\nIP: {{ipAddress}}\nTime: {{timestamp}}\n\nIf you did not perform this action, please secure your account immediately.",
  },

  email_verification: {
    subject: "Verify your email address",
    preheader: "Click the link to confirm your email for Finchippay notifications.",
    accentColor: "#6C63FF",
    html: `
      <p>Hi! Please verify your email address to enable email notifications.</p>
      <p>Click the button below (valid for <strong>24 hours</strong>):</p>
      <a href="{{verificationUrl}}" class="btn">Verify Email Address</a>
      <p style="font-size:12px;color:#999;">Or copy this link: <br /><a href="{{verificationUrl}}">{{verificationUrl}}</a></p>
      <p style="font-size:12px;color:#999;">If you did not request this, you can safely ignore this email.</p>
    `,
    text: "Verify your email\n\nClick this link to verify your email:\n{{verificationUrl}}\n\nValid for 24 hours. If you did not request this, ignore this email.",
  },

  digest: {
    subject: "Your {{appName}} daily digest ({{count}} events)",
    preheader: "Here's a summary of your recent activity.",
    accentColor: "#6C63FF",
    html: `
      <p>Here's a summary of your recent activity on <strong>{{appName}}</strong>:</p>
      {{#each events}}
      <div style="border:1px solid #ebebeb;border-radius:6px;padding:12px 16px;margin-bottom:12px;">
        <strong>{{this.label}}</strong>
        <span style="font-size:12px;color:#999;float:right;">{{this.timestamp}}</span>
        <br />
        <span style="font-size:14px;color:#444;">{{this.summary}}</span>
      </div>
      {{/each}}
      {{#if viewUrl}}<a href="{{viewUrl}}" class="btn">View All Activity</a>{{/if}}
    `,
    text: "Your {{appName}} Daily Digest\n\n{{#each events}}• {{this.label}}: {{this.summary}} ({{this.timestamp}})\n{{/each}}",
  },
};

// Compile all templates once
const COMPILED = {};
for (const [key, tpl] of Object.entries(RAW_TEMPLATES)) {
  COMPILED[key] = {
    subject: Handlebars.compile(tpl.subject),
    html: Handlebars.compile(tpl.html),
    text: Handlebars.compile(tpl.text),
    preheader: tpl.preheader,
    accentColor: tpl.accentColor,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a full HTML email with optional tracking pixel.
 *
 * @param {string} templateType  - One of the keys in RAW_TEMPLATES
 * @param {object} data          - Template context
 * @param {object} [opts]
 * @param {string} [opts.trackingPixelUrl]
 * @param {string} [opts.unsubscribeUrl]
 * @returns {{ html: string, text: string, subject: string }}
 */
function render(templateType, data, opts) {
  if (!opts) opts = {};
  const tpl = COMPILED[templateType];
  if (!tpl) {
    throw new Error(`Unknown email template: ${templateType}`);
  }
  const ctx = Object.assign({ appName: APP_NAME, dashboardUrl: `${BASE_URL}/dashboard` }, data);
  const innerHtml = tpl.html(ctx);
  const title = tpl.subject(ctx);
  const html = layout({
    title,
    preheader: tpl.preheader,
    accentColor: tpl.accentColor,
    body: innerHtml,
    unsubscribeUrl: opts.unsubscribeUrl || `${BASE_URL}/unsubscribe`,
    trackingPixelUrl: opts.trackingPixelUrl || "",
  });
  const text = tpl.text(ctx);
  return { html, text, subject: title };
}

/**
 * List available template types.
 * @returns {string[]}
 */
function availableTemplates() {
  return Object.keys(RAW_TEMPLATES);
}

module.exports = { render, availableTemplates, COMPILED };
