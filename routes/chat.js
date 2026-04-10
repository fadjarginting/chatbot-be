const express = require("express");
const { runAgent } = require("../agent/agent");
const {
  ensureChatSession,
  ensureUser,
  listSavedHotelsBySession,
  saveChatMessage,
} = require("../mcp/database");
const {
  appendSessionMessage,
  ensureSession,
  getSessionMessageCount,
  getSessionMessages,
  hydrateSessionFromDb,
  resolveSessionId,
} = require("../memory/sessionStore");

const router = express.Router();

function detectSaveIntent(message) {
  const text = String(message || "").toLowerCase();
  return /(save|simpan|bookmark|bookmarks|catat|tandai|favorit|favorite)/i.test(text);
}

// router.get("/", (req, res) => {
//   return res.status(200).json({
//     message: "Chat endpoint is available. Use POST /chat with JSON body: { message: string }",
//     example: {
//       method: "POST",
//       path: "/chat",
//       body: {
//         message: "Cari hotel murah di Bali",
//       },
//     },
//   });
// });

router.post("/", async (req, res, next) => {
  try {
    const { message, sessionId, user } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Invalid request body. 'message' must be a non-empty string.",
      });
    }

    const activeSessionId = ensureSession(sessionId);
    await hydrateSessionFromDb(activeSessionId);
    appendSessionMessage(activeSessionId, { role: "user", content: message });

    let userId = null;
    if (user && typeof user === "object") {
      const externalUserId = typeof user.externalUserId === "string" ? user.externalUserId : null;
      const displayName = typeof user.displayName === "string" ? user.displayName : null;
      const userRecord = await ensureUser({
        externalUserId,
        displayName,
      });
      userId = userRecord?.id || null;
    }

    await ensureChatSession({
      sessionId: activeSessionId,
      userId,
      title: message.slice(0, 80),
      metadata: {
        source: "chat-route",
      },
    });

    await saveChatMessage({
      sessionId: activeSessionId,
      role: "user",
      content: message,
    });

    const sessionMessages = getSessionMessages(activeSessionId);
    const allowSaveHotel = detectSaveIntent(message);

    console.log(
      "[Route /chat] Incoming message:",
      message,
      "sessionId:",
      activeSessionId,
      "messagesInMemory:",
      getSessionMessageCount(activeSessionId)
    );

    const result = await runAgent({
      sessionId: activeSessionId,
      messages: sessionMessages,
      allowSaveHotel,
    });

    appendSessionMessage(activeSessionId, { role: "assistant", content: result.reply });
    return res.status(200).json({
      sessionId: activeSessionId,
      reply: result.reply,
      toolTrace: result.toolTrace,
      messagesInMemory: getSessionMessageCount(activeSessionId),
    });
  } catch (error) {
    console.error("[Route /chat] Error:", error);
    return next(error);
  }
});

router.get("/saved-hotels", async (req, res, next) => {
  try {
    const requestedSessionId = typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
    const limitRaw = Number(req.query.limit || 20);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 20;

    if (!requestedSessionId) {
      return res.status(400).json({
        error: "Query parameter 'sessionId' is required.",
      });
    }

    const sessionId = resolveSessionId(requestedSessionId);

    const savedHotels = await listSavedHotelsBySession({ sessionId, limit });
    return res.status(200).json({
      sessionId,
      count: savedHotels.length,
      items: savedHotels,
    });
  } catch (error) {
    console.error("[Route /chat/saved-hotels] Error:", error);
    return next(error);
  }
});

module.exports = router;
