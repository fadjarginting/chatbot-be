const { createChatCompletion } = require("../services/aiClient");
const { getToolDefinitions, executeTool } = require("./tools");
const { getSessionMessageCount } = require("../memory/sessionStore");
const {
  saveChatMessage,
  saveLlmRequest,
  saveToolCall,
} = require("../mcp/database");

const SYSTEM_PROMPT = `
You are a helpful hotel recommendation assistant.
When user asks for hotel recommendation by location or budget:
1) Call getHotels first.
2) Analyze results and pick best recommendation.
3) Only call saveHotel when user explicitly asks to save/bookmark/simpan hotel.
4) Then explain recommendation clearly to user.
`.trim();

async function runAgent({ sessionId, messages, allowSaveHotel = false }) {
  const conversationMessages = Array.isArray(messages) ? messages : [];
  const sanitizedConversationMessages = conversationMessages
    .filter((message) => ["user", "assistant", "system"].includes(message?.role))
    .map((message) => ({
      role: message.role,
      content: typeof message.content === "string" ? message.content : String(message.content || ""),
    }));

  const messagesForModel = [
    { role: "system", content: SYSTEM_PROMPT },
    ...sanitizedConversationMessages,
  ];
  const toolsForRun = getToolDefinitions({ allowSaveHotel });

  const toolTrace = [];
  const maxIterations = 5;

  console.log(
    "[Agent] Starting session:",
    sessionId,
    "messagesInMemory:",
    getSessionMessageCount(sessionId)
  );

  for (let i = 0; i < maxIterations; i += 1) {
    console.log(`[Agent] Iteration ${i + 1}: requesting model response`);
    const llmRequestStartedAt = Date.now();
    let assistantMessage;

    let llmRequestRecord = null;

    try {
      assistantMessage = await createChatCompletion({
        messages: messagesForModel,
        tools: toolsForRun,
        toolChoice: "auto",
      });

      llmRequestRecord = await saveLlmRequest({
        sessionId,
        model: "openai/gpt-4o-mini",
        inputMessageCount: messagesForModel.length,
        latencyMs: Date.now() - llmRequestStartedAt,
        status: "success",
      });
    } catch (error) {
      await saveLlmRequest({
        sessionId,
        model: "openai/gpt-4o-mini",
        inputMessageCount: messagesForModel.length,
        latencyMs: Date.now() - llmRequestStartedAt,
        status: "failed",
        errorMessage: error.message,
      }).catch((dbError) => {
        console.error("[Agent] Failed to persist failed LLM request:", dbError.message);
      });

      throw error;
    }

    const toolCalls = assistantMessage.tool_calls || [];

    if (!toolCalls.length) {
      const finalReply = assistantMessage.content || "No response generated.";
      await saveChatMessage({
        sessionId,
        role: "assistant",
        content: finalReply,
      }).catch((dbError) => {
        console.error("[Agent] Failed to persist assistant reply:", dbError.message);
      });
      console.log("[Agent] Final reply generated.");
      return {
        reply: finalReply,
        toolTrace,
      };
    }

    messagesForModel.push({
      role: "assistant",
      content: assistantMessage.content || null,
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const functionName = toolCall.function?.name;
      const rawArgs = toolCall.function?.arguments || "{}";

      let parsedArgs;
      try {
        parsedArgs = JSON.parse(rawArgs);
      } catch (parseError) {
        console.error("[Agent] Invalid tool arguments:", rawArgs);
        parsedArgs = {};
      }

      console.log(`[Agent] Executing tool: ${functionName}`, parsedArgs);

      try {
        const toolResult = await executeTool(functionName, parsedArgs, {
          sessionId,
          allowSaveHotel,
        });

        const toolMessage = await saveChatMessage({
          sessionId,
          role: "tool",
          content: JSON.stringify(toolResult),
          toolCallId: toolCall.id,
          toolName: functionName,
        });

        await saveToolCall({
          sessionId,
          toolName: functionName,
          llmRequestId: llmRequestRecord?.id || null,
          messageId: toolMessage?.id || null,
          argumentsJson: parsedArgs,
          resultJson: toolResult,
          status: "success",
        }).catch((dbError) => {
          console.error("[Agent] Failed to persist tool call:", dbError.message);
        });

        toolTrace.push({
          tool: functionName,
          arguments: parsedArgs,
          result: toolResult,
        });

        messagesForModel.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      } catch (toolError) {
        console.error(`[Agent] Tool execution failed (${functionName}):`, toolError.message);

        await saveChatMessage({
          sessionId,
          role: "tool",
          content: JSON.stringify({ error: toolError.message }),
          toolCallId: toolCall.id,
          toolName: functionName,
        }).catch((dbError) => {
          console.error("[Agent] Failed to persist failed tool message:", dbError.message);
        });

        await saveToolCall({
          sessionId,
          toolName: functionName,
          llmRequestId: llmRequestRecord?.id || null,
          argumentsJson: parsedArgs,
          errorMessage: toolError.message,
          status: "failed",
        }).catch((dbError) => {
          console.error("[Agent] Failed to persist failed tool call:", dbError.message);
        });

        toolTrace.push({
          tool: functionName,
          arguments: parsedArgs,
          error: toolError.message,
        });

        messagesForModel.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: toolError.message }),
        });
      }
    }
  }

  throw new Error("Agent reached max tool-calling iterations without final response.");
}

module.exports = {
  runAgent,
};
