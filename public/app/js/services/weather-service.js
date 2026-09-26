/**
 * Weather service — real data, no invented values ever.
 *
 * Provider: Open-Meteo (https://open-meteo.com) — a free forecast API that
 * needs no API key, so weather works out of the box and no secret ships to
 * the browser. Place names come from BigDataCloud's keyless reverse geocoder;
 * if that fails we show coordinates rather than guessing a city.
 *
 * This module does networking + shaping only. Permission prompts and rendering
 * live in modules/weather.js.
 */

import { STORES, readValue, writeValue } from "../db/indexeddb.js";

export const WEATHER_PROVIDER = "Open-Meteo";
export const WEATHER_PROVIDER_CONFIGURED = true;

const LOCATION_KEY = "weatherLocation";
const CACHE_KEY = "weatherCache";
const CACHE_MS = 15 * 60 * 1000;

/* WMO weather interpretation codes → short human labels. */
const CONDITIONS = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

export function conditionLabel(code) {
  return CONDITIONS[code] || "";
}

/* ---------- Saved location ---------- */
export async function getSavedLocation() {
  return readValue(STORES.settings, LOCATION_KEY, null);
}

export async function saveLocation(location) {
  return writeValue(STORES.settings, LOCATION_KEY, location);
}

export async function clearLocation() {
  await writeValue(STORES.settings, LOCATION_KEY, null);
  await writeValue(STORES.settings, CACHE_KEY, null);
}

export function isGeolocationSupported() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/**
 * Asks the browser for coordinates. Must be triggered by a user gesture.
 * Resolves to { ok: true, location } or { ok: false, reason }.
 */
export function requestLocation() {
  return new Promise((resolve) => {
    if (!isGeolocationSupported()) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const location = {
          lat: Number(latitude.toFixed(3)),
          lon: Number(longitude.toFixed(3)),
          name: await reverseGeocode(latitude, longitude),
          savedAt: new Date().toISOString(),
        };
        await saveLocation(location);
        await writeValue(STORES.settings, CACHE_KEY, null);
        resolve({ ok: true, location });
      },
      (error) => {
        const reason = error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
        resolve({ ok: false, reason });
      },
      { timeout: 12000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("geocode failed");
    const data = await response.json();
    return data.city || data.locality || data.principalSubdivision || data.countryName || "";
  } catch {
    return ""; // Callers fall back to coordinates — never a made-up place.
  }
}

/**
 * Current weather for the saved location.
 * Returns a discriminated result; callers render the reason, never fake data.
 *   { available: true, location, temp, condition, code, high, low, rainChance, rainNote, fetchedAt, cached }
 *   { available: false, reason: no-location|offline|error|no-provider, message }
 */
export async function getCurrentWeather({ force = false } = {}) {
  if (!WEATHER_PROVIDER_CONFIGURED) {
    return { available: false, reason: "no-provider", message: "No weather provider configured" };
  }

  const location = await getSavedLocation();
  if (!location) {
    return { available: false, reason: "no-location", message: "Location not shared yet" };
  }

  const cached = await readValue(STORES.settings, CACHE_KEY, null);
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MS;
  if (!force && fresh) return { ...cached, cached: true, stale: false };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    // Offline: show the last real reading, clearly labelled — never invented data.
    if (cached) return { ...cached, cached: true, stale: true, reason: "offline" };
    return { available: false, reason: "offline", message: "Weather unavailable offline" };
  }

  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${location.lat}&longitude=${location.lon}` +
      "&current=temperature_2m,weather_code" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max" +
      "&hourly=precipitation_probability" +
      "&forecast_days=1&timezone=auto";

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
    const data = await response.json();

    const code = data.current?.weather_code;
    const result = {
      available: true,
      provider: WEATHER_PROVIDER,
      location: location.name || `${location.lat}, ${location.lon}`,
      temp: Math.round(data.current?.temperature_2m),
      condition: conditionLabel(code),
      code,
      high: Math.round(data.daily?.temperature_2m_max?.[0]),
      low: Math.round(data.daily?.temperature_2m_min?.[0]),
      rainChance: data.daily?.precipitation_probability_max?.[0] ?? null,
      rainNote: rainNote(data.hourly),
      fetchedAt: new Date().toISOString(),
    };

    if (!Number.isFinite(result.temp)) throw new Error("Weather provider returned no temperature");

    await writeValue(STORES.settings, CACHE_KEY, result);
    return { ...result, cached: false, stale: false };
  } catch (error) {
    if (cached) return { ...cached, cached: true, stale: true, reason: "error" };
    return {
      available: false,
      reason: "error",
      message: error.message || "Could not reach the weather provider",
    };
  }
}

/** "Rain possible after 5 PM" — only when the forecast actually says so. */
function rainNote(hourly) {
  const times = hourly?.time;
  const probs = hourly?.precipitation_probability;
  if (!Array.isArray(times) || !Array.isArray(probs)) return "";

  const now = Date.now();
  for (let i = 0; i < times.length; i += 1) {
    const at = new Date(times[i]).getTime();
    if (at < now) continue;
    if ((probs[i] ?? 0) >= 50) {
      const label = new Date(times[i]).toLocaleTimeString(undefined, { hour: "numeric" });
      return `Rain possible after ${label}`;
    }
  }
  return "";
}
