const axios = require("axios");

const SERPAPI_SEARCH_URL = "https://serpapi.com/search.json";

const fallbackHotels = [
  { name: "Sunrise Bali Inn", price: 320000, rating: 4.2, location: "Bali" },
  { name: "Kuta Budget Stay", price: 250000, rating: 4.0, location: "Bali" },
  { name: "Ubud Green Resort", price: 550000, rating: 4.6, location: "Bali" },
  { name: "Jakarta City Lodge", price: 400000, rating: 4.1, location: "Jakarta" },
  { name: "Bandung Cozy Hotel", price: 300000, rating: 4.3, location: "Bandung" },
];

function getFallbackHotels(location) {
  const normalized = String(location || "").trim().toLowerCase();
  return fallbackHotels.filter((hotel) => hotel.location.toLowerCase().includes(normalized));
}

function estimatePriceByPosition(position) {
  const basePrice = 250000;
  return basePrice + (Number(position || 1) - 1) * 75000;
}

function estimateRatingByPosition(position) {
  const score = 4.6 - (Number(position || 1) - 1) * 0.15;
  return Number(Math.max(3.8, Math.min(4.8, score)).toFixed(1));
}

function mapSearchResultToHotel(item, location) {
  const cleanTitle = String(item?.title || "").trim();
  return {
    name: cleanTitle || `Hotel in ${location}`,
    price: estimatePriceByPosition(item?.position),
    rating: estimateRatingByPosition(item?.position),
    location,
  };
}

function getDefaultStayDates() {
  const checkIn = new Date();
  checkIn.setDate(checkIn.getDate() + 7);

  const checkOut = new Date(checkIn);
  checkOut.setDate(checkOut.getDate() + 1);

  const toDateString = (date) => date.toISOString().split("T")[0];

  return {
    checkInDate: toDateString(checkIn),
    checkOutDate: toDateString(checkOut),
  };
}

async function fetchHotelsFromSerpApi(location) {
  const serpapiKey = process.env.SERPAPI_KEY;

  if (!serpapiKey) {
    throw new Error("SERPAPI_KEY is missing in environment variables.");
  }

  const { checkInDate, checkOutDate } = getDefaultStayDates();

  const response = await axios.get(SERPAPI_SEARCH_URL, {
    params: {
      engine: "google_hotels",
      q: `budget hotels in ${location}`,
      api_key: serpapiKey,
      check_in_date: checkInDate,
      check_out_date: checkOutDate,
      adults: 2,
      gl: "id",
      hl: "id",
    },
    timeout: 30000,
  });

  const properties = response?.data?.properties || [];
  const mapped = properties.slice(0, 5).map((item, index) => ({
    name: String(item?.name || item?.type || "").trim() || `Hotel in ${location}`,
    price: Number(item?.rate_per_night?.lowest) || estimatePriceByPosition(index + 1),
    rating: Number(item?.overall_rating) || estimateRatingByPosition(index + 1),
    location,
  }));

  // Fallback to regular web results when hotel property results are empty.
  if (mapped.length > 0) {
    return mapped;
  }

  const fallbackResponse = await axios.get(SERPAPI_SEARCH_URL, {
    params: {
      engine: "google",
      q: `best budget hotels in ${location}`,
      api_key: serpapiKey,
      num: 5,
      gl: "id",
      hl: "id",
    },
    timeout: 30000,
  });

  const webResults = fallbackResponse?.data?.organic_results || [];
  return webResults.slice(0, 5).map((item) => mapSearchResultToHotel(item, location));
}

async function getHotels(location) {
  console.log("[MCP A] Fetching hotel data for location:", location);

  const normalizedLocation = String(location || "").trim();
  if (!normalizedLocation) {
    return [];
  }

  try {
    const hotels = await fetchHotelsFromSerpApi(normalizedLocation);

    if (hotels.length > 0) {
      console.log("[MCP A] SerpAPI results:", hotels.length);
      return hotels;
    }

    console.warn("[MCP A] SerpAPI returned no hotel results. Using fallback data.");
    return getFallbackHotels(normalizedLocation);
  } catch (error) {
    const status = error?.response?.status;
    const details = error?.response?.data || error.message;
    console.error("[MCP A] SerpAPI request failed:", status, details);
    return getFallbackHotels(normalizedLocation);
  }
}

module.exports = {
  getHotels,
};
