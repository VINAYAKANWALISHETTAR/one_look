/**
 * Weather UI component (compact card for Home + the More settings row).
 *
 * Owns the geolocation permission flow: the browser is only asked after the
 * user taps "Use my location". Every failure state is shown as itself —
 * there is no fallback to invented weather.
 */

import { el, clear } from "./ui.js";
import { STORES, readValue, writeValue } from "../db/indexeddb.js";
import * as weatherService from "../services/weather-service.js";

const DENIED_KEY = "weatherLocationDenied";

export async function locationDenied() {
  return Boolean(await readValue(STORES.settings, DENIED_KEY, false));
}

/** Human summary used on the More page. */
export async function locationSummary() {
  if (!weatherService.isGeolocationSupported()) return "Location isn't available in this browser";
  const location = await weatherService.getSavedLocation();
  if (location) return `Using ${location.name || `${location.lat}, ${location.lon}`}`;
  if (await locationDenied()) return "Location permission was blocked";
  return "Location not shared yet";
}

export async function shareLocation() {
  const result = await weatherService.requestLocation();
  await writeValue(STORES.settings, DENIED_KEY, result.reason === "denied");
  return result;
}

export async function forgetLocation() {
  await weatherService.clearLocation();
  await writeValue(STORES.settings, DENIED_KEY, false);
}

function line(text, cls = "tiny faint") {
  return el("div", { class: cls, text });
}

/**
 * Returns a self-updating weather card element.
 * Renders a loading state first, then the real result.
 *
 * Deliberately one short row: place, temperature, condition, high/low, rain and
 * a refresh action. Nothing else.
 */
export function weatherCard() {
  const card = el("div", { class: "panel panel-pad weather" });

  const paint = (children) => {
    clear(card);
    for (const child of [].concat(children)) if (child) card.append(child);
  };

  const actionRow = (label, onClick) =>
    el("button", { class: "btn btn-sm", type: "button", onClick }, label);

  const load = async ({ force = false } = {}) => {
    paint(line("Checking the weather…", "small muted"));
    const result = await weatherService.getCurrentWeather({ force });

    if (result.available) {
      const meta = [
        Number.isFinite(result.high) && Number.isFinite(result.low)
          ? `H ${result.high}° · L ${result.low}°`
          : "",
        result.rainChance !== null && result.rainChance !== undefined
          ? `Rain ${result.rainChance}%`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");

      paint([
        el("div", { class: "weather-row" }, [
          el("span", { class: "weather-temp tabular", text: `${result.temp}°` }),
          el("div", { class: "grow" }, [
            el("div", { class: "weather-place truncate", text: result.location }),
            el("div", { class: "small truncate", text: result.condition || "—" }),
            meta ? el("div", { class: "weather-meta truncate", text: meta }) : null,
          ]),
          el("button", {
            class: "btn btn-sm",
            "data-variant": "ghost",
            type: "button",
            text: "Refresh",
            "aria-label": "Refresh weather",
            onClick: () => load({ force: true }),
          }),
        ]),
        // Stale data is always labelled as stale — never shown as live.
        result.stale ? line("Last known weather — you are offline.", "tiny warn") : null,
      ]);
      return;
    }


    if (result.reason === "no-location") {
      const denied = await locationDenied();
      if (!weatherService.isGeolocationSupported()) {
        paint(line("Weather needs location, which this browser doesn't offer.", "small muted"));
        return;
      }
      if (denied) {
        paint([
          line("Weather is off because location is blocked.", "small muted"),
          line("Allow location for this site in your browser settings, then try again."),
          actionRow("Try again", async () => {
            paint(line("Waiting for location…", "small muted"));
            const shared = await shareLocation();
            if (shared.ok) load({ force: true });
            else load();
          }),
        ]);
        return;
      }
      paint([
        el("div", { class: "spread" }, [
          el("div", { class: "grow" }, [
            el("div", { class: "small", text: "Weather" }),
            line("Share your location to see real conditions."),
          ]),
          actionRow("Use my location", async () => {
            paint(line("Waiting for location…", "small muted"));
            const shared = await shareLocation();
            if (shared.ok) load({ force: true });
            else load();
          }),
        ]),
      ]);
      return;
    }

    // offline with no cached reading / provider error / not configured
    paint([
      line(
        result.reason === "offline"
          ? "Weather unavailable offline."
          : result.message || "Weather is unavailable right now.",
        "small muted",
      ),
      result.reason === "offline" ? null : actionRow("Retry", () => load({ force: true })),
    ]);
  };

  // When the connection comes back, weather may refresh normally again.
  const onOnline = () => {
    // Cards from a previous render are detached; drop their listener instead of stacking up.
    if (!card.isConnected) {
      window.removeEventListener("online", onOnline);
      return;
    }
    load({ force: true }).catch(() => {});
  };
  window.addEventListener("online", onOnline);

  load().catch(() => paint(line("Weather is unavailable right now.", "small muted")));
  return card;
}
