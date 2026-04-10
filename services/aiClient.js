const axios = require("axios");

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";

function sanitizeMessagesForProvider(messages) {
  const safeMessages = [];
  let pendingToolCallIds = new Set();

  for (const message of messages) {
    const role = message?.role;

    if (!["system", "user", "assistant", "tool"].includes(role)) {
      continue;
    }

    if (role === "assistant") {
      const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      pendingToolCallIds = new Set(
        toolCalls.map((toolCall) => toolCall?.id).filter(Boolean)
      );

      safeMessages.push({
        role: "assistant",
        content: message?.content ?? null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (role === "tool") {
      const toolCallId = message?.tool_call_id;

      // Keep tool messages only when they correspond to a preceding assistant tool call.
      if (toolCallId && pendingToolCallIds.has(toolCallId)) {
        safeMessages.push({
          role: "tool",
          tool_call_id: toolCallId,
          content: typeof message?.content === "string" ? message.content : JSON.stringify(message?.content || {}),
        });
        pendingToolCallIds.delete(toolCallId);
      }
      continue;
    }

    // Reset dangling tool call context when a normal user/system turn starts.
    pendingToolCallIds = new Set();
    safeMessages.push({
      role,
      content: typeof message?.content === "string" ? message.content : String(message?.content || ""),
    });
  }

  return safeMessages;
}

async function createChatCompletion({ messages, tools, toolChoice = "auto", model = DEFAULT_MODEL }) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing in environment variables.");
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("messages must be a non-empty array.");
  }

  const sanitizedMessages = sanitizeMessagesForProvider(messages);

  try {
    console.log("[AI Client] Sending request to OpenRouter...", "messageCount:", sanitizedMessages.length);

    const response = await axios.post(
      OPENROUTER_URL,
      {
        model,
        messages: sanitizedMessages,
        tools,
        tool_choice: toolChoice,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );

    const choice = response?.data?.choices?.[0]?.message;

    if (!choice) {
      throw new Error("OpenRouter response did not include a valid message choice.");
    }

    return choice;
  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    const errorMessage = data?.error?.message || error.message;
    
    console.error("[AI Client] OpenRouter error:", status, data || error.message);
    
    if (status === 401) {
      console.error("[AI Client] Authentication failed. Possible causes:");
      console.error("  - Invalid or revoked API key");
      console.error("  - OpenRouter account deleted or suspended");
      console.error("  - Account has no active billing");
      console.error("[AI Client] API Key configured (first 20 chars):", apiKey?.substring(0, 20) + "...");
      throw new Error(`OpenRouter authentication failed (401): ${errorMessage}`);
    }
    
    throw new Error("Failed to get response from OpenRouter API.");
  }
}

module.exports = {
  createChatCompletion,
};
