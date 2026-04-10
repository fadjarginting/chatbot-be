const { getHotels } = require("../mcp/hotelAPI");
const { saveHotel } = require("../mcp/database");

const baseToolDefinitions = [
  {
    type: "function",
    function: {
      name: "getHotels",
      description: "Fetch hotel data by location.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "City or area to search hotels, e.g. Bali",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "saveHotel",
      description: "Save selected hotel to database only when user explicitly asks to save/bookmark.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number" },
          rating: { type: "number" },
          location: { type: "string" },
        },
        required: ["name", "price", "rating", "location"],
      },
    },
  },
];

function getToolDefinitions({ allowSaveHotel = false } = {}) {
  if (allowSaveHotel) {
    return baseToolDefinitions;
  }

  return baseToolDefinitions.filter((tool) => tool.function?.name !== "saveHotel");
}

async function executeTool(name, args, context = {}) {
  switch (name) {
    case "getHotels":
      return getHotels(args.location);
    case "saveHotel":
      if (!context.allowSaveHotel) {
        return {
          saved: false,
          reason: "Skipped because user did not explicitly request save/bookmark.",
        };
      }

      return saveHotel({
        name: args.name,
        price: args.price,
        rating: args.rating,
        location: args.location,
      }, {
        sessionId: context.sessionId,
        recommendation: true,
        reason: context.reason,
      });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

module.exports = {
  getToolDefinitions,
  executeTool,
};
