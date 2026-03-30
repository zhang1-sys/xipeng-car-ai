function maskPhoneNumber(value) {
  return String(value || "").replace(/\b(1[3-9]\d)\d{4}(\d{4})\b/g, "$1****$2");
}

function maskEmailAddress(value) {
  return String(value || "").replace(
    /\b([A-Za-z0-9._%+-]{1,64})@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    (_, localPart, domain) => `${localPart.slice(0, 2)}***@${domain}`
  );
}

function maskMiddle(value, prefix = 6, suffix = 2) {
  const raw = String(value || "");
  if (!raw) return raw;
  if (raw.length <= prefix + suffix) {
    return `${raw.slice(0, Math.max(1, Math.min(prefix, raw.length)))}***`;
  }
  return `${raw.slice(0, prefix)}***${raw.slice(-suffix)}`;
}

function maskAddressText(value) {
  const raw = String(value || "");
  if (!raw.trim()) return raw;

  const maskedChinese = raw.replace(
    /([\u4e00-\u9fa5]{2,}(?:省|市|区|县|镇|乡|村|街道|大道|路|街|巷|弄)[^,，。；;\n]{2,30}(?:号|栋|楼|单元|室)?)/g,
    (match) => maskMiddle(match, 6, 2)
  );

  return maskedChinese.replace(
    /\b(\d{1,5}\s+[A-Za-z0-9.' -]{2,40}\s(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct))\b/gi,
    (match) => maskMiddle(match, 6, 2)
  );
}

function approximateCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Number((Math.round(numeric * 100) / 100).toFixed(2));
}

function sanitizeSensitiveString(value, { maskAddress = false } = {}) {
  let sanitized = maskEmailAddress(maskPhoneNumber(String(value || "")));
  if (maskAddress) {
    sanitized = maskAddressText(sanitized);
  }
  return sanitized;
}

function isPhoneKey(key) {
  return ["phone", "mobile", "tel", "contactphone", "assignedstorephone"].some((token) =>
    key.includes(token)
  );
}

function isEmailKey(key) {
  return ["email", "mail"].some((token) => key.includes(token));
}

function isAddressKey(key) {
  return [
    "address",
    "addr",
    "mapquery",
    "storeaddress",
    "assignedstoreaddress",
    "locationtext",
  ].some((token) => key.includes(token));
}

function isCoordinateKey(key) {
  return ["lat", "lng", "latitude", "longitude", "coord"].some((token) => key.includes(token));
}

function isFreeTextKey(key) {
  return ["remark", "note", "comment", "message", "summary", "reason"].some((token) =>
    key.includes(token)
  );
}

function sanitizeSensitiveValue(value, options = {}) {
  const { maskPlainTextAddresses = false } = options;

  if (typeof value === "string") {
    return sanitizeSensitiveString(value, { maskAddress: maskPlainTextAddresses });
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeSensitiveValue(item, options));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};
  for (const [key, childValue] of Object.entries(value)) {
    const normalizedKey = String(key || "").toLowerCase();

    if (isCoordinateKey(normalizedKey)) {
      sanitized[key] =
        typeof childValue === "number" || typeof childValue === "string"
          ? approximateCoordinate(childValue)
          : null;
      continue;
    }

    if (typeof childValue === "string") {
      if (isPhoneKey(normalizedKey)) {
        sanitized[key] = maskPhoneNumber(childValue);
        continue;
      }
      if (isEmailKey(normalizedKey)) {
        sanitized[key] = maskEmailAddress(childValue);
        continue;
      }
      if (isAddressKey(normalizedKey)) {
        sanitized[key] = maskAddressText(sanitizeSensitiveString(childValue));
        continue;
      }
      if (isFreeTextKey(normalizedKey)) {
        sanitized[key] = sanitizeSensitiveString(childValue, { maskAddress: true });
        continue;
      }
      sanitized[key] = sanitizeSensitiveString(childValue, {
        maskAddress: maskPlainTextAddresses,
      });
      continue;
    }

    sanitized[key] = sanitizeSensitiveValue(childValue, options);
  }

  return sanitized;
}

function sanitizeConversationEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  return {
    ...event,
    userMessage: sanitizeSensitiveString(event.userMessage, { maskAddress: true }),
    assistantReply: sanitizeSensitiveString(event.assistantReply, { maskAddress: true }),
    structured: sanitizeSensitiveValue(event.structured, { maskPlainTextAddresses: true }),
    agent: sanitizeSensitiveValue(event.agent, { maskPlainTextAddresses: true }),
    metadata: sanitizeSensitiveValue(event.metadata),
  };
}

function sanitizeLeadRecord(lead) {
  return sanitizeSensitiveValue(lead, { maskPlainTextAddresses: false });
}

function sanitizeAuditEvent(event) {
  if (!event || typeof event !== "object") {
    return event;
  }

  return {
    ...event,
    actor: sanitizeSensitiveString(event.actor),
    ip: sanitizeSensitiveString(event.ip),
    userAgent: sanitizeSensitiveString(event.userAgent),
    metadata: sanitizeSensitiveValue(event.metadata, { maskPlainTextAddresses: true }),
  };
}

module.exports = {
  approximateCoordinate,
  maskAddressText,
  maskEmailAddress,
  maskPhoneNumber,
  sanitizeAuditEvent,
  sanitizeConversationEvent,
  sanitizeLeadRecord,
  sanitizeSensitiveString,
  sanitizeSensitiveValue,
};
