/**
 * src/services/emailTemplates.js
 * Handlebars email templates for payment notification events.
 */

"use strict";

const Handlebars = require("handlebars");

var TEMPLATES = {};

TEMPLATES.payment_received = Handlebars.compile(
  '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px;">' +
    '<div style="background:linear-gradient(135deg,#667eea,#764ba2);padding:30px;border-radius:10px;color:#fff;text-align:center;">' +
    '<h1 style="margin:0;font-size:24px;">Payment Received</h1></div>' +
    '<div style="padding:30px;background:#f9f9f9">' +
    "<p>You received <strong>{{amount}} {{asset}}</strong> from {{sender}}</p>" +
    '<table style="width:100%"><tr><td>Amount</td><td><strong>{{amount}} {{asset}}</strong></td></tr>' +
    "<tr><td>From</td><td>{{sender}}</td></tr>" +
    "<tr><td>To</td><td>{{recipient}}</td></tr>" +
    "{{#if memo}}<tr><td>Memo</td><td>{{memo}}</td></tr>{{/if}}" +
    "<tr><td>Time</td><td>{{timestamp}}</td></tr></table>" +
    '<p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">Finchippay Solution</p></div></div>',
);

TEMPLATES.escrow_released = Handlebars.compile(
  '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px;">' +
    '<div style="background:linear-gradient(135deg,#43e97b,#38f9d7);padding:30px;border-radius:10px;color:#fff;text-align:center;">' +
    '<h1 style="margin:0;font-size:24px;">Escrow Released</h1></div>' +
    '<div style="padding:30px;background:#f9f9f9">' +
    "<p>Escrow of <strong>{{amount}} {{asset}}</strong> released!</p>" +
    '<table style="width:100%"><tr><td>Amount</td><td><strong>{{amount}} {{asset}}</strong></td></tr>' +
    "<tr><td>Released To</td><td>{{recipient}}</td></tr>" +
    "<tr><td>Released By</td><td>{{sender}}</td></tr>" +
    "<tr><td>Time</td><td>{{timestamp}}</td></tr></table>" +
    '<p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">Finchippay Solution</p></div></div>',
);

TEMPLATES.stream_depleted = Handlebars.compile(
  '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px;">' +
    '<div style="background:linear-gradient(135deg,#f093fb,#f5576c);padding:30px;border-radius:10px;color:#fff;text-align:center;">' +
    '<h1 style="margin:0;font-size:24px;">Stream Depleted</h1></div>' +
    '<div style="padding:30px;background:#f9f9f9">' +
    "<p>Your payment stream has been depleted.</p>" +
    '<table style="width:100%"><tr><td>Total Streamed</td><td><strong>{{amount}} {{asset}}</strong></td></tr>' +
    "<tr><td>Recipient</td><td>{{recipient}}</td></tr>" +
    "{{#if memo}}<tr><td>Memo</td><td>{{memo}}</td></tr>{{/if}}" +
    "<tr><td>Time</td><td>{{timestamp}}</td></tr></table>" +
    '<p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">Finchippay Solution</p></div></div>',
);

TEMPLATES.multisig_executed = Handlebars.compile(
  '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px;">' +
    '<div style="background:linear-gradient(135deg,#4facfe,#00f2fe);padding:30px;border-radius:10px;color:#fff;text-align:center;">' +
    '<h1 style="margin:0;font-size:24px;">Multi-Sig Executed</h1></div>' +
    '<div style="padding:30px;background:#f9f9f9">' +
    "<p>A multi-signature transaction has been executed!</p>" +
    '<table style="width:100%"><tr><td>Amount</td><td><strong>{{amount}} {{asset}}</strong></td></tr>' +
    "<tr><td>To</td><td>{{recipient}}</td></tr>" +
    "<tr><td>From</td><td>{{sender}}</td></tr>" +
    "{{#if memo}}<tr><td>Memo</td><td>{{memo}}</td></tr>{{/if}}" +
    "<tr><td>Time</td><td>{{timestamp}}</td></tr></table>" +
    '<p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">Finchippay Solution</p></div></div>',
);

TEMPLATES.tip_received = Handlebars.compile(
  '<div style="font-family:Arial;max-width:600px;margin:0 auto;padding:20px;">' +
    '<div style="background:linear-gradient(135deg,#fa709a,#fee140);padding:30px;border-radius:10px;color:#fff;text-align:center;">' +
    '<h1 style="margin:0;font-size:24px;">Tip Received!</h1></div>' +
    '<div style="padding:30px;background:#f9f9f9">' +
    "<p>You received a tip of <strong>{{amount}} {{asset}}</strong>!</p>" +
    '<table style="width:100%"><tr><td>Amount</td><td><strong>{{amount}} {{asset}}</strong></td></tr>' +
    "<tr><td>From</td><td>{{sender}}</td></tr>" +
    "{{#if memo}}<tr><td>Message</td><td>{{memo}}</td></tr>{{/if}}" +
    "<tr><td>Time</td><td>{{timestamp}}</td></tr></table>" +
    '<p style="margin-top:20px;font-size:12px;color:#999;text-align:center;">Finchippay Solution</p></div></div>',
);

function renderTemplate(eventType, data) {
  if (!data) data = {};
  var template = TEMPLATES[eventType];
  if (!template) {
    throw new Error("Unknown email template type: " + eventType);
  }
  return template(data);
}

function renderPlainText(eventType, data) {
  if (!data) data = {};
  var labels = {
    payment_received: "Payment Received",
    escrow_released: "Escrow Released",
    stream_depleted: "Stream Depleted",
    multisig_executed: "Multi-Sig Executed",
    tip_received: "Tip Received",
  };
  var label = labels[eventType] || eventType;
  var text =
    label +
    String.fromCharCode(10) +
    "=".repeat(label.length) +
    String.fromCharCode(10) +
    String.fromCharCode(10);
  text += "Amount: " + (data.amount || "?") + " " + (data.asset || "XLM") + String.fromCharCode(10);
  if (data.sender) text += "From: " + data.sender + String.fromCharCode(10);
  if (data.recipient) text += "To: " + data.recipient + String.fromCharCode(10);
  if (data.memo) text += "Memo: " + data.memo + String.fromCharCode(10);
  if (data.timestamp) text += "Time: " + data.timestamp + String.fromCharCode(10);
  text += String.fromCharCode(10) + "---" + String.fromCharCode(10) + "Finchippay Solution";
  return text;
}

module.exports = {
  TEMPLATES: TEMPLATES,
  renderTemplate: renderTemplate,
  renderPlainText: renderPlainText,
};
