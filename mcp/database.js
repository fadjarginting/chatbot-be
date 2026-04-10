const { createClient } = require("@supabase/supabase-js");
const { createHash } = require("crypto");

let supabaseClient;

function isMissingTableError(error) {
  return error?.code === "PGRST205" || /Could not find the table/i.test(error?.message || "");
}

function isMissingColumnError(error) {
  return /could not find the .* column/i.test(error?.message || "") || error?.code === "42703";
}

function isRlsDeniedError(error) {
  return error?.code === "42501" || /row-level security policy/i.test(error?.message || "");
}

function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY must be set.");
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey);
  return supabaseClient;
}

function createSourceHotelId({ source, name, location }) {
  return createHash("sha1")
    .update(`${String(source || "serpapi").trim().toLowerCase()}|${String(name || "").trim().toLowerCase()}|${String(location || "").trim().toLowerCase()}`)
    .digest("hex");
}

async function ensureChatSession({ sessionId, userId = null, title = null, metadata = {} }) {
  const supabase = getSupabaseClient();
  const payload = {
    id: sessionId,
    user_id: userId,
    title,
    metadata,
    last_activity_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("chat_sessions")
    .upsert([payload], { onConflict: "id" })
    .select()
    .single();

  if (error) {
    console.error("[DB] ensureChatSession error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] chat_sessions table is not available yet. Falling back to memory-only mode.");
      return null;
    }

    throw new Error(`Failed to ensure chat session: ${error.message || "Unknown Supabase error."}`);
  }

  return data;
}

async function ensureUser({ externalUserId, displayName = null }) {
  if (!externalUserId || typeof externalUserId !== "string") {
    return null;
  }

  const supabase = getSupabaseClient();
  const payload = {
    external_user_id: externalUserId.trim(),
    display_name: displayName,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("users")
    .upsert([payload], { onConflict: "external_user_id" })
    .select()
    .single();

  if (error) {
    console.error("[DB] ensureUser error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] users table is not available yet. Proceeding without user persistence.");
      return null;
    }

    if (isRlsDeniedError(error)) {
      console.warn("[DB] users write blocked by RLS policy. Proceeding without user persistence.");
      return null;
    }

    throw new Error(`Failed to ensure user: ${error.message || "Unknown Supabase error."}`);
  }

  return data;
}

async function touchChatSession(sessionId) {
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from("chat_sessions")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", sessionId);

  if (error) {
    console.error("[DB] touchChatSession error:", error);
  }
}

async function saveChatMessage({ sessionId, role, content, toolCallId = null, toolName = null, tokenCount = null }) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .insert([
      {
        session_id: sessionId,
        role,
        content,
        tool_call_id: toolCallId,
        tool_name: toolName,
        token_count: tokenCount,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("[DB] saveChatMessage error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] chat_messages table is not available yet. Skipping persistence for this message.");
      return null;
    }

    throw new Error(`Failed to save chat message: ${error.message || "Unknown Supabase error."}`);
  }

  await touchChatSession(sessionId);
  return data;
}

async function saveLlmRequest({
  sessionId,
  provider = "openrouter",
  model,
  inputMessageCount = 0,
  promptTokens = null,
  completionTokens = null,
  totalTokens = null,
  latencyMs = null,
  status = "success",
  errorMessage = null,
}) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("llm_requests")
    .insert([
      {
        session_id: sessionId,
        provider,
        model,
        input_message_count: inputMessageCount,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        latency_ms: latencyMs,
        status,
        error_message: errorMessage,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("[DB] saveLlmRequest error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] llm_requests table is not available yet. Skipping persistence for this request.");
      return null;
    }

    throw new Error(`Failed to save LLM request: ${error.message || "Unknown Supabase error."}`);
  }

  await touchChatSession(sessionId);
  return data;
}

async function saveToolCall({
  sessionId,
  llmRequestId = null,
  messageId = null,
  toolName,
  argumentsJson = {},
  resultJson = null,
  errorMessage = null,
  status = "success",
}) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("tool_calls")
    .insert([
      {
        session_id: sessionId,
        llm_request_id: llmRequestId,
        message_id: messageId,
        tool_name: toolName,
        arguments_json: argumentsJson,
        result_json: resultJson,
        error_message: errorMessage,
        status,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("[DB] saveToolCall error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] tool_calls table is not available yet. Skipping tool call persistence.");
      return null;
    }

    throw new Error(`Failed to save tool call: ${error.message || "Unknown Supabase error."}`);
  }

  await touchChatSession(sessionId);
  return data;
}

async function saveHotelRecommendation({ sessionId, hotelId, messageId = null, reason = null, rank = 1 }) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("hotel_recommendations")
    .insert([
      {
        session_id: sessionId,
        hotel_id: hotelId,
        message_id: messageId,
        reason,
        rank,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("[DB] saveHotelRecommendation error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] hotel_recommendations table is not available yet. Skipping recommendation persistence.");
      return null;
    }

    throw new Error(`Failed to save hotel recommendation: ${error.message || "Unknown Supabase error."}`);
  }

  await touchChatSession(sessionId);
  return data;
}

async function saveSessionSavedHotel({ sessionId, hotelId, snapshot, savedBy = "assistant" }) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("session_saved_hotels")
    .insert([
      {
        session_id: sessionId,
        hotel_id: hotelId,
        snapshot,
        saved_by: savedBy,
      },
    ])
    .select()
    .single();

  if (error) {
    console.error("[DB] saveSessionSavedHotel error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] session_saved_hotels table is not available yet. Skipping session snapshot persistence.");
      return null;
    }

    throw new Error(`Failed to save session hotel snapshot: ${error.message || "Unknown Supabase error."}`);
  }

  await touchChatSession(sessionId);
  return data;
}

async function getSessionMessagesFromDb(sessionId, limit = 15) {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("chat_messages")
    .select("role, content, tool_call_id, tool_name, created_at")
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant", "system"])
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    console.error("[DB] getSessionMessagesFromDb error:", error);
    if (isMissingTableError(error)) {
      console.warn("[DB] chat_messages table is not available yet. Starting with empty hydrated session.");
      return [];
    }

    throw new Error(`Failed to load session messages: ${error.message || "Unknown Supabase error."}`);
  }

  return Array.isArray(data) ? data.map((message) => ({
    role: message.role,
    content: message.content,
    tool_call_id: message.tool_call_id,
    tool_name: message.tool_name,
  })) : [];
}

async function upsertHotel(data) {
  console.log("[MCP B] Saving hotel to Supabase:", data);

  const supabase = getSupabaseClient();
  const source = String(data?.source || "serpapi").trim().toLowerCase();
  const sourceHotelId = data?.sourceHotelId || createSourceHotelId({
    source,
    name: data?.name,
    location: data?.location,
  });

  const hotelRecord = {
    source,
    source_hotel_id: sourceHotelId,
    name: data?.name,
    price: data?.price ?? null,
    rating: data?.rating ?? null,
    location: data?.location,
    currency: data?.currency || "IDR",
    metadata: data?.metadata || {},
  };

  const legacyHotelRecord = {
    name: data?.name,
    price: data?.price ?? null,
    rating: data?.rating ?? null,
    location: data?.location,
  };

  let inserted = null;
  let error = null;

  const upsertResult = await supabase
    .from("hotels")
    .upsert([hotelRecord], { onConflict: "source,source_hotel_id" })
    .select()
    .single();

  inserted = upsertResult.data;
  error = upsertResult.error;

  if (error) {
    console.error("[MCP B] Supabase insert error:", error);

    if (isMissingTableError(error)) {
      console.warn("[MCP B] hotels table is not available yet. Returning in-memory hotel result only.");
      return {
        ...hotelRecord,
        id: null,
        persisted: false,
      };
    }

    if (isMissingColumnError(error)) {
      console.warn("[MCP B] hotels table is still on an older schema. Falling back to legacy insert columns.");

      const legacyResult = await supabase
        .from("hotels")
        .insert([legacyHotelRecord])
        .select()
        .single();

      if (legacyResult.error) {
        console.error("[MCP B] Legacy hotel insert error:", legacyResult.error);
        throw new Error(`Failed to save hotel data to database: ${legacyResult.error.message || "Unknown Supabase error."}`);
      }

      return legacyResult.data || {
        ...legacyHotelRecord,
        id: null,
        persisted: true,
      };
    }

    throw new Error(`Failed to save hotel data to database: ${error.message || "Unknown Supabase error."}`);
  }

  return inserted || null;
}

async function saveHotel(data, context = {}) {
  const savedHotel = await upsertHotel(data);

  if (context.sessionId && savedHotel?.id) {
    await saveSessionSavedHotel({
      sessionId: context.sessionId,
      hotelId: savedHotel.id,
      snapshot: savedHotel,
      savedBy: context.savedBy || "assistant",
    });

    if (context.recommendation) {
      await saveHotelRecommendation({
        sessionId: context.sessionId,
        hotelId: savedHotel.id,
        messageId: context.messageId || null,
        reason: context.reason || "Selected by the assistant as the best match.",
        rank: context.rank || 1,
      });
    }
  }

  return savedHotel;
}

async function listSavedHotelsBySession({ sessionId, limit = 20 }) {
  const supabase = getSupabaseClient();

  const { data: savedRows, error: savedError } = await supabase
    .from("session_saved_hotels")
    .select("id, session_id, hotel_id, saved_by, snapshot, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (savedError) {
    console.error("[DB] listSavedHotelsBySession error:", savedError);
    if (isMissingTableError(savedError) || isRlsDeniedError(savedError)) {
      return [];
    }

    throw new Error(`Failed to list saved hotels: ${savedError.message || "Unknown Supabase error."}`);
  }

  if (!Array.isArray(savedRows) || savedRows.length === 0) {
    return [];
  }

  const hotelIds = [...new Set(savedRows.map((row) => row.hotel_id).filter(Boolean))];
  if (hotelIds.length === 0) {
    return savedRows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      savedBy: row.saved_by,
      savedAt: row.created_at,
      hotel: row.snapshot || null,
    }));
  }

  const { data: hotels, error: hotelsError } = await supabase
    .from("hotels")
    .select("id, source, source_hotel_id, name, location, price, currency, rating, metadata, created_at")
    .in("id", hotelIds);

  if (hotelsError) {
    console.error("[DB] listSavedHotelsBySession hotels lookup error:", hotelsError);
    if (isMissingColumnError(hotelsError)) {
      const { data: legacyHotels, error: legacyHotelsError } = await supabase
        .from("hotels")
        .select("id, name, location, price, rating, created_at")
        .in("id", hotelIds);

      if (legacyHotelsError) {
        console.error("[DB] listSavedHotelsBySession legacy hotels lookup error:", legacyHotelsError);
      } else {
        const legacyHotelsById = new Map((legacyHotels || []).map((hotel) => [hotel.id, hotel]));
        return savedRows.map((row) => ({
          id: row.id,
          sessionId: row.session_id,
          savedBy: row.saved_by,
          savedAt: row.created_at,
          hotel: legacyHotelsById.get(row.hotel_id) || row.snapshot || null,
        }));
      }
    }

    if (isMissingTableError(hotelsError) || isRlsDeniedError(hotelsError)) {
      return savedRows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        savedBy: row.saved_by,
        savedAt: row.created_at,
        hotel: row.snapshot || null,
      }));
    }

    throw new Error(`Failed to list saved hotels: ${hotelsError.message || "Unknown Supabase error."}`);
  }

  const hotelsById = new Map((hotels || []).map((hotel) => [hotel.id, hotel]));

  return savedRows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    savedBy: row.saved_by,
    savedAt: row.created_at,
    hotel: hotelsById.get(row.hotel_id) || row.snapshot || null,
  }));
}

module.exports = {
  ensureUser,
  ensureChatSession,
  listSavedHotelsBySession,
  saveChatMessage,
  saveHotel,
  saveHotelRecommendation,
  saveLlmRequest,
  saveSessionSavedHotel,
  getSessionMessagesFromDb,
  saveToolCall,
};
