async function fetchRSSItems(feedUrl) {
  const jinaUrl = `https://r.jina.ai/http://${feedUrl.replace(/^https?:\/\//i, "")}`;

  try {
    const response = await fetch(jinaUrl, {
      headers: {
        Accept: "application/xml",
        "X-Return-Format": "html",
      },
    });
    if (!response.ok) {
      throw new Error(`RSS proxy HTTP ${response.status}`);
    }

    const content = await response.text();
    const xmlStart = content.search(/<(?:rss|feed)\b/i);

    if (xmlStart !== -1) {
      const xml = new DOMParser().parseFromString(
        content.slice(xmlStart),
        "application/xml",
      );

      if (!xml.querySelector("parsererror")) {
        return parseRSSXML(xml);
      }
    }

    const items = parseRSSMarkdown(content);
    if (!items.length) {
      throw new Error("Invalid RSS proxy response");
    }

    return items;
  } catch (jinaError) {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(feedUrl)}`;
    const response = await fetch(proxyUrl, {
      credentials: "omit",
    });

    if (!response.ok) {
      throw new Error(
        `RSS fetch failed: ${jinaError.message}; fallback HTTP ${response.status}`,
      );
    }

    const xmlText = await response.text();
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");

    if (xml.querySelector("parsererror")) {
      throw new Error("Invalid RSS XML");
    }

    return parseRSSXML(xml);
  }
}

function parseRSSXML(xml) {
  return Array.from(xml.querySelectorAll("item")).map((item) => ({
    title: item.querySelector("title")?.textContent?.trim() || "",
    link: item.querySelector("link")?.textContent?.trim() || "",
    pubDate: item.querySelector("pubDate")?.textContent?.trim() || "",
    description: item.querySelector("description")?.textContent?.trim() || "",
    content:
      item.getElementsByTagNameNS(
        "http://purl.org/rss/1.0/modules/content/",
        "encoded",
      )[0]?.textContent || "",
    thumbnail:
      item.querySelector("thumbnail")?.getAttribute("url") ||
      item.querySelector("enclosure")?.getAttribute("url") ||
      "",
  }));
}

function parseRSSMarkdown(markdown) {
  const items = [];
  const itemPattern =
    /^### \[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*\r?\n\r?\n(?:\[.*?\]\(.*?\)\s*\r?\n)?([^\r\n]*)/gm;

  for (const match of markdown.matchAll(itemPattern)) {
    items.push({
      title: match[1].trim(),
      link: match[2],
      pubDate: match[3].trim(),
      description: "",
      content: "",
      thumbnail: "",
    });
  }

  return items;
}

async function loadMediaUpdates({
  elementId,
  url,
  progressLabel,
  emptyMessage,
  errorMessage,
}) {
  const updatesElement = document.getElementById(elementId);
  if (!updatesElement) return;

  try {
    const items = await fetchRSSItems(url);

    const updates = await Promise.all(
      items.slice(0, 5).map((item) => createMediaCard(item, progressLabel)),
    );

    updatesElement.replaceChildren();
    updates.forEach((update) => updatesElement.append(update));

    if (!items.length) {
      const message = document.createElement("p");
      message.textContent = emptyMessage;
      updatesElement.append(message);
    }
  } catch (error) {
    console.error(`${elementId} error`, error);
    updatesElement.replaceChildren();

    const message = document.createElement("p");
    message.textContent = errorMessage;
    updatesElement.append(message);
  }
}

function initAnimeUpdates() {
  return loadMediaUpdates({
    elementId: "anime-updates",
    url: "https://myanimelist.net/rss.php?type=rw&u=Nooby3103",
    progressLabel: "ep.",
    emptyMessage: "no anime updates",
    errorMessage: "unable to load anime updates",
  });
}

function initMangaUpdates() {
  return loadMediaUpdates({
    elementId: "manga-updates",
    url: "https://myanimelist.net/rss.php?type=rm&u=Nooby3103",
    progressLabel: "ch.",
    emptyMessage: "no manga updates",
    errorMessage: "unable to load manga updates",
  });
}

function createMediaCard(item, progressLabel) {
  const card = document.createElement("article");
  const cover = document.createElement("img");
  const details = document.createElement("div");
  const date = document.createElement("span");
  const status = document.createElement("span");
  const title = document.createElement("strong");
  const progress = document.createElement("span");

  const description = item.description || item.content || "";
  const rawStatus = description.split(" - ")[0] || "unknown";
  const statusKey = rawStatus.toLowerCase().replace(/[^a-z]+/g, "-");

  const progressMatch = description.match(
    /(\d+)\s+of\s+(\?|\d+)\s+(episodes?|chapters?)/i,
  );

  const cleanTitle = (item.title || "untitled").replace(
    /\s+-\s+(TV|Movie|OVA|ONA|Special|Manga|Light Novel|Doujinshi)$/i,
    "",
  );

  card.className = "media-card";
  details.className = "media-details";

  title.className = "media-title";
  title.textContent = cleanTitle;

  date.className = "media-date";
  date.textContent = `updated: ${formatMediaDate(item.pubDate)}`;

  status.className = `media-status status-${statusKey}`;
  status.textContent = formatMediaStatus(rawStatus);

  progress.className = "media-progress";
  progress.textContent = progressMatch
    ? `${progressLabel} ${progressMatch[1]}/${progressMatch[2]}`
    : `${progressLabel} unknown`;

  details.append(title, date, status, progress);
  card.append(details);

  getMediaMetadata(item).then((metadata) => {
    if (!metadata.image) return;

    cover.className = "media-cover";
    cover.src = metadata.image;
    cover.alt = `${cleanTitle} cover`;
    cover.loading = "lazy";
    card.prepend(cover);
  });

  return card;
}

let jikanQueue = Promise.resolve();

function fetchJikanDetails(type, id) {
  const request = jikanQueue.then(async function () {
    await new Promise((resolve) => window.setTimeout(resolve, 400));

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    let response;

    try {
      response = await fetch(`https://api.jikan.moe/v4/${type}/${id}`, {
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }

    if (response.status === 429) return null;
    if (!response.ok) return null;

    const data = await response.json();
    return data.data || null;
  });

  jikanQueue = request.catch(() => null);
  return request;
}

async function getMediaMetadata(item) {
  const description = item.description || item.content || "";

  const imageMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);

  const yearMatch = (item.title || "").match(
    /(?:^|,\s*)((?:19|20)\d{2})(?:\s+-|$)/,
  );

  const metadata = {
    image: imageMatch ? imageMatch[1] : item.thumbnail || "",
    year: yearMatch ? yearMatch[1] : "",
  };

  const malMatch = (item.link || "").match(
    /myanimelist\.net\/(anime|manga)\/(\d+)/i,
  );

  if (!malMatch) return metadata;

  try {
    const details = await fetchJikanDetails(malMatch[1], malMatch[2]);

    if (!details) return metadata;

    metadata.image =
      details.images?.jpg?.large_image_url ||
      details.images?.jpg?.image_url ||
      metadata.image;

    metadata.year =
      details.year ||
      details.aired?.prop?.from?.year ||
      details.published?.prop?.from?.year ||
      metadata.year;
  } catch (error) {
    console.error("media cover error", error);
  }

  return metadata;
}
function createFilmCard(item) {
  const card = document.createElement("article");
  const cover = document.createElement("img");
  const details = document.createElement("div");
  const title = document.createElement("strong");
  const year = document.createElement("span");
  const date = document.createElement("span");
  const rating = document.createElement("span");

  const description = item.description || item.content || "";

  const imageMatch = description.match(/<img[^>]+src=["']([^"']+)["']/i);

  const ratingMatch = (item.title || "").match(/\s+-\s+(★+[½]?)$/);
  const yearMatch = (item.title || "").match(/,\s*((?:19|20)\d{2})\s+-/);

  const cleanTitle = (item.title || "untitled")
    .replace(/,\s*((?:19|20)\d{2})\s+-\s+★+[½]?$/, "")
    .trim();

  card.className = "media-card film-card";
  details.className = "media-details";

  if (imageMatch) {
    cover.className = "media-cover";
    cover.src = imageMatch[1];
    cover.alt = `${cleanTitle} cover`;
    cover.loading = "lazy";
    card.append(cover);
  }

  title.className = "media-title";
  title.textContent = cleanTitle;

  year.className = "media-year";
  year.textContent = yearMatch ? `year: ${yearMatch[1]}` : "year: unknown";

  date.className = "media-date";
  date.textContent = `watched: ${formatMediaDate(item.pubDate)}`;

  rating.className = "media-rating";
  rating.textContent = ratingMatch
    ? `rating: ${ratingMatch[1]}`
    : "rating: unrated";

  details.append(title, year, date, rating);
  card.append(details);

  return card;
}

async function initFilmUpdates() {
  const updatesElement = document.getElementById("film-updates");
  if (!updatesElement) return;

  const url = "https://letterboxd.com/nooby3103/rss/";

  try {
    const items = await fetchRSSItems(url);

    const updates = items.slice(0, 5).map(createFilmCard);

    updatesElement.replaceChildren();
    updates.forEach((update) => updatesElement.append(update));

    if (!items.length) {
      const message = document.createElement("p");
      message.textContent = "no film updates";
      updatesElement.append(message);
    }
  } catch (error) {
    console.error("film updates error", error);
    updatesElement.replaceChildren();

    const message = document.createElement("p");
    message.textContent = "unable to load film updates";
    updatesElement.append(message);
  }
}

function formatMediaStatus(value) {
  const labels = {
    "plan to watch": "ptw",
    "plan to read": "ptr",
    "on-hold": "on hold",
  };

  return labels[value.toLowerCase()] || value.toLowerCase();
}

function formatMediaDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "--月--日";
  }

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${month}月${day}日`;
}

async function initNowPlaying() {
  const spanElement = document.getElementById("nowplaying");
  const cdImage = document.getElementById("nowplaying-cd");
  const nowPlayingText = document.getElementById("nowplaying-text");

  if (!spanElement || !cdImage || !nowPlayingText) return;

  const url = "https://www.ballix.net/whatsplaying/now?user=Nooby3103";

  async function updateNowPlaying() {
    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      const isNowPlaying =
        data.nowplaying === "true" || data.nowplaying === true;

      const artist = data.artist || "";
      const title = data.name || "";

      if (!title && !artist) {
        nowPlayingText.textContent = "No recent tracks";
        cdImage.title = "No recent tracks";
        return;
      }

      const description = `${title} – ${artist}`;

      nowPlayingText.textContent = description;
      cdImage.title = description;
    } catch (error) {
      console.error("lastfm / ballix error", error);
      nowPlayingText.textContent = "Unable to load now playing";
      cdImage.title = "Unable to load now playing";
    }
  }

  await updateNowPlaying();
  window.setInterval(updateNowPlaying, 30000);
}
document.addEventListener("DOMContentLoaded", async function () {
  const site = document.querySelector(".site");
  const includes = document.querySelectorAll("[data-include]");

  try {
    await Promise.all(
      [...includes].map(async function (element) {
        const response = await fetch(element.dataset.include);

        if (!response.ok) {
          throw new Error(`Unable to load ${element.dataset.include}`);
        }

        element.outerHTML = await response.text();
      }),
    );

    const profile = document.querySelector("[data-profile-value]");

    if (profile) {
      profile.textContent = document.body.dataset.profile || "france";
    }

    const emailButton = document.getElementById("e-btn");
    const copyButton = document.getElementById("copy-btn");
    const hideButton = document.getElementById("hide-btn");

    if (emailButton && copyButton && hideButton) {
      const encodedEmail = "dGl0Y2hvdTY4QGdtYWlsLmNvbQ== (base64)";
      const rawEmail = "dGl0Y2hvdTY4QGdtYWlsLmNvbQ==";

      emailButton.addEventListener("click", function () {
        emailButton.textContent = encodedEmail;
        emailButton.style.textDecoration = "none";
        emailButton.style.color = "var(--fg)";
        emailButton.style.wordBreak = "break-all";
        emailButton.style.whiteSpace = "normal";
        emailButton.style.cursor = "text";

        copyButton.style.display = "flex";
        copyButton.style.cursor = "pointer";

        hideButton.style.display = "flex";
        hideButton.style.cursor = "pointer";
      });

      copyButton.addEventListener("click", function () {
        navigator.clipboard.writeText(rawEmail);
        this.innerText = "copied";
      });

      hideButton.addEventListener("click", function () {
        hideButton.style.display = "none";
        copyButton.style.display = "none";
        copyButton.innerText = "copy";

        emailButton.textContent = "email";
        emailButton.style.textDecoration = "underline";
        emailButton.style.color = "var(--link)";
        emailButton.style.cursor = "pointer";
      });
    }

    initAnimeUpdates();
    initMangaUpdates();
    initFilmUpdates();
    initNowPlaying();

    document.dispatchEvent(new Event("includes-loaded"));
  } catch (error) {
    console.error(error);
  } finally {
    if (site) site.classList.add("includes-ready");
  }
});
