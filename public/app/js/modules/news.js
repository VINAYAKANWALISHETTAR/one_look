/**
 * News briefing UI — a short read, not a feed.
 *
 * Real stories from the provider in services/news-service.js (Hacker News).
 * Every story links out to its source; nothing is summarised or rewritten, so
 * there is no risk of a fabricated headline.
 */

import { el, clear, card, sectionHead, emptyState } from "./ui.js";
import * as router from "../router.js";
import * as news from "../services/news-service.js";

const line = (text, cls = "tiny faint") => el("div", { class: cls, text });

/** Relative age of a story, from the provider's own timestamp. */
function ago(iso) {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** One compact story row: headline, source, time. */
function storyRow(story) {
  const meta = [story.source, ago(story.publishedAt)].filter(Boolean).join(" · ");

  return el(
    "a",
    { class: "story-row", href: story.url, target: "_blank", rel: "noopener noreferrer" },
    [
      el("div", { class: "grow" }, [
        el("div", { class: "story-title truncate", text: story.title }),
        meta ? el("div", { class: "tiny faint truncate", text: meta }) : null,
      ]),
    ],
  );
}

/** Home briefing: five headlines, loads on its own. */
export async function renderBriefing(container) {
  clear(container);

  const head = sectionHead(
    "News briefing",
    el("button", {
      class: "link-btn",
      type: "button",
      text: "All topics",
      onClick: () => router.navigate("/news"),
    }),
  );

  const panel = card(line("Loading the briefing…", "small muted"));
  container.append(head, panel);

  const briefing = await news.getHeadlines({ limit: 5 });
  clear(panel);

  if (!briefing.available) {
    panel.append(line(briefing.message || "News is unavailable right now.", "small muted"));
    return;
  }

  if (!briefing.stories.length) {
    panel.append(line("No strong stories right now.", "small muted"));
    return;
  }

  panel.classList.remove("panel-pad");
  panel.append(
    el(
      "div",
      { class: "list" },
      briefing.stories.map((story) => storyRow(story)),
    ),
  );
  if (briefing.stale) {
    panel.append(
      el("div", { class: "panel-pad" }, [line("Saved briefing — you are offline.", "tiny warn")]),
    );
  }
}

/** Full News screen with the five topics. */
export async function renderNews(container) {
  clear(container);

  let active = news.TOPICS[0].id;

  container.append(
    el("header", {}, [
      el("h1", { class: "page-title", text: "News" }),
      el("p", {
        class: "page-sub",
        text: `Top stories of the last few days from ${news.NEWS_PROVIDER}.`,
      }),
    ]),
  );

  const list = card(null, { pad: false, className: "" });
  list.style.marginTop = "12px";
  const meta = el("p", { class: "tiny faint", style: "margin-top:8px" });

  const draw = async ({ force = false } = {}) => {
    clear(list).append(el("div", { class: "empty", text: "Loading stories…" }));
    meta.textContent = "";

    const briefing = await news.getBriefing(active, { limit: 10, force });
    clear(list);

    if (!briefing.available) {
      list.append(emptyState("News is unavailable", briefing.message || ""));
      return;
    }
    if (!briefing.stories.length) {
      list.append(emptyState("No strong stories in this topic right now"));
      return;
    }

    list.append(
      el(
        "div",
        { class: "list" },
        briefing.stories.map((story) => storyRow(story)),
      ),
    );

    const updated = new Date(briefing.fetchedAt).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    meta.textContent = briefing.stale
      ? `Saved briefing from ${updated} — you are offline.`
      : `Updated ${updated} · ${news.NEWS_PROVIDER}`;
  };

  const filters = el(
    "div",
    { class: "filters" },
    news.TOPICS.map((topic) =>
      el(
        "button",
        {
          class: "filter",
          type: "button",
          "data-active": String(active === topic.id),
          onClick: (event) => {
            active = topic.id;
            for (const sibling of event.currentTarget.parentNode.children) {
              sibling.setAttribute("data-active", String(sibling === event.currentTarget));
            }
            draw().catch(() => {});
          },
        },
        topic.label,
      ),
    ),
  );

  container.append(
    filters,
    list,
    meta,
    el(
      "div",
      { class: "row", style: "margin-top:12px" },
      [
        el(
          "button",
          { class: "btn btn-sm", type: "button", onClick: () => draw({ force: true }).catch(() => {}) },
          "Refresh",
        ),
      ],
    ),
  );

  await draw();
}

export { storyRow };
