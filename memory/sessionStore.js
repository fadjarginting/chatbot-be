const { createHash, randomUUID } = require("crypto");
const { getSessionMessagesFromDb } = require("../mcp/database");

const sessions = Object.create(null);
const MAX_SESSION_MESSAGES = 15;

function generateSessionId() {
  return randomUUID();
}

function normalizeSessionId(sessionId) {
  if (typeof sessionId !== "string") {
    return "";
  }

  return sessionId.trim();
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hashToUuid(input) {
  const hash = createHash("sha1").update(input).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function resolveSessionId(sessionId) {
  const raw = normalizeSessionId(sessionId);
  if (!raw) {
    return generateSessionId();
  }

  if (isUuid(raw)) {
    return raw.toLowerCase();
  }

  return hashToUuid(raw.toLowerCase());
}

function ensureSession(sessionId) {
  const normalizedSessionId = resolveSessionId(sessionId);

  if (!sessions[normalizedSessionId]) {
    sessions[normalizedSessionId] = [];
  }

  return normalizedSessionId;
}

function getSessionMessages(sessionId) {
  const normalizedSessionId = normalizeSessionId(sessionId);

  if (!normalizedSessionId || !sessions[normalizedSessionId]) {
    return [];
  }

  return [...sessions[normalizedSessionId]];
}

function setSessionMessages(sessionId, messages) {
  const normalizedSessionId = ensureSession(sessionId);
  const safeMessages = Array.isArray(messages) ? messages : [];

  sessions[normalizedSessionId] = safeMessages.slice(-MAX_SESSION_MESSAGES);

  return getSessionMessages(normalizedSessionId);
}

function appendSessionMessage(sessionId, message) {
  const normalizedSessionId = ensureSession(sessionId);
  const currentMessages = getSessionMessages(normalizedSessionId);

  currentMessages.push(message);
  sessions[normalizedSessionId] = currentMessages.slice(-MAX_SESSION_MESSAGES);

  return getSessionMessages(normalizedSessionId);
}

function getSessionMessageCount(sessionId) {
  return getSessionMessages(sessionId).length;
}

async function hydrateSessionFromDb(sessionId) {
  const normalizedSessionId = resolveSessionId(sessionId);

  if (!normalizedSessionId) {
    return [];
  }

  if (sessions[normalizedSessionId] && sessions[normalizedSessionId].length > 0) {
    return getSessionMessages(normalizedSessionId);
  }

  const dbMessages = await getSessionMessagesFromDb(normalizedSessionId, MAX_SESSION_MESSAGES);
  sessions[normalizedSessionId] = dbMessages.slice(-MAX_SESSION_MESSAGES);
  return getSessionMessages(normalizedSessionId);
}

module.exports = {
  MAX_SESSION_MESSAGES,
  appendSessionMessage,
  ensureSession,
  generateSessionId,
  getSessionMessageCount,
  getSessionMessages,
  hydrateSessionFromDb,
  resolveSessionId,
  setSessionMessages,
};