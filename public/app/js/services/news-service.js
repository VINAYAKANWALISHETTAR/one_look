/**
 * News service — real stories, no invented headlines.
 *
 * Provider: Hacker News through the public Algolia search API
 * (https://hn.algolia.com/api). It needs no API key and no backend, so the
 * briefing works on a purely local install, and no secret ships to the browser.
 *
 * Each topic is a real query with a points floor and a recency window, so the
 * briefing is "what actually mattered in the last few days" rather than a feed.
 * Results are cached in IndexedDB; offline we serve the last real briefing,
 * clearly labelled as stale.
 */

import { STORES, readValue, writeValue } from "../db/indexeddb.js";

export const NEWS_PROVIDER = "Hacker News";

const CACHE_PREFIX = "news:";
const CACHE_MS = 30 * 60 * 1000;
const WINDOW_DAYS = 3;

export const TOPICS = [
  { id: "technology", label: "Technology", query: "technology OR hardware OR cloud", points: 80 },
  { id: "programming", label: "Programming", query: "programming OR javascript OR python", points: 60 },
  { id: "ai", label: "AI", query: "AI OR LLM OR machine learning", points: 60 },
  { id: "business", label: "Business", query: "business OR economy OR market", points: 60 },
  { id: "startups", label: "Startups", query: "startup OR founders OR funding", points: 40 },
];

export const topicLabel = (id) => TOPICS.find((topic) => topic.id === id)?.label || "News";

function sourceOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "news.ycombinator.com";
  }
}

function toStory(hit, topicId) {
  const hnUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const url = hit.url || hnUrl;
  return {
    id: `${topicId}:${hit.objectID}`,
    topic: topicId,
    title: hit.title || hit.story_title || "",
    url,
    discussionUrl: hnUrl,
    source: sourceOf(url),
    points: hit.points ?? 0,
    comments: hit.num_comments ?? 0,
    publishedAt: hit.created_at || null,
  };
}

async function fetchTopic(topic, limit) {
  const since = Math.floor((Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);
  const url =
    "https://hn.algolia.com/api/v1/search?" +
    new URLSearchParams({
      tags: "story",
      query: topic.query,
      numericFilters: `created_at_i>${since},points>${topic.points}`,
      hitsPerPage: String(Math.min(Math.max(limit, 5), 20)),
    });

  const response = await fetch(url);
  if (!response.ok) throw new Error(`News provider returned ${response.status}`);
  const data = await response.json();

  return (data.hits || [])
    .filter((hit) => hit.title)
    .map((hit) => toStory(hit, topic.id))
    .sort((a, b) => b.points - a.points)
    .slice(0, limit);
}

/**
 * Briefing for one topic.
 *   { available: true, topic, stories, fetchedAt, stale }
 *   { available: false, reason: offline|error, message }
 */
export async function getBriefing(topicId = "technology", { limit = 8, force = false } = {}) {
  const topic = TOPICS.find((entry) => entry.id === topicId) || TOPICS[0];
  const key = `${CACHE_PREFIX}${topic.id}`;
  const cached = await readValue(STORES.settings, key, null);
  const fresh = cached && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_MS;

  if (!force && fresh) return { ...cached, stale: false, cached: true };

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (cached) return { ...cached, stale: true, cached: true, reason: "offline" };
    return { available: false, reason: "offline", message: "News needs a connection." };
  }

  try {
    const stories = await fetchTopic(topic, limit);
    const result = {
      available: true,
      provider: NEWS_PROVIDER,
      topic: topic.id,
      topicLabel: topic.label,
      stories,
      fetchedAt: new Date().toISOString(),
    };
    await writeValue(STORES.settings, key, result);
    return { ...result, stale: false, cached: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true, cached: true, reason: "error" };
    return {
      available: false,
      reason: "error",
      message: error.message || "Could not reach the news provider.",
    };
  }
}

/** Top few stories across topics — used by the Home briefing row. */
export async function getHeadlines({ limit = 3 } = {}) {
  const briefing = await getBriefing("technology", { limit: Math.max(limit, 5) });
  if (!briefing.available) return briefing;
  return { ...briefing, stories: briefing.stories.slice(0, limit) };
}

/** Search across the cached briefings — real stories only, no network needed. */
export async function searchStories(query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return [];

  const hits = [];
  for (const topic of TOPICS) {
    const cached = await readValue(STORES.settings, `${CACHE_PREFIX}${topic.id}`, null);
    for (const story of cached?.stories || []) {
      if (`${story.title} ${story.source}`.toLowerCase().includes(q)) hits.push(story);
    }
  }
  return hits.sort((a, b) => b.points - a.points).slice(0, 12);
}
