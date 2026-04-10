const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const chatRoute = require("./routes/chat");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/chat", chatRoute);

app.use((err, req, res, next) => {
  console.error("[Server] Unhandled error:", err);
  const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  const exposeMessage =
    (statusCode >= 400 && statusCode < 500) ||
    String(err?.code || "").startsWith("OPENROUTER_");

  res.status(statusCode).json({
    error: exposeMessage ? err.message : "Internal server error",
    code: err?.code || "UNHANDLED_ERROR",
    ...(process.env.NODE_ENV !== "production" ? { details: err?.message } : {}),
  });
});

app.listen(PORT, () => {
  console.log(`[Server] Listening on port ${PORT}`);
});
