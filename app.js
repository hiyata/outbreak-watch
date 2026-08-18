const LAST_SEEN_KEY = "outbreak-watch:last-seen";

const listEl = document.getElementById("list");
const metaEl = document.getElementById("meta");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");

let allItems = [];
let lastSeen = localStorage.getItem(LAST_SEEN_KEY);

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  let items = allItems.filter((item) => {
    if (!query) return true;
    const haystack = `${item.title} ${item.disease ?? ""} ${item.summary}`.toLowerCase();
    return haystack.includes(query);
  });

  if (sortEl.value === "unread") {
    items = [...items].sort((a, b) => {
      const aNew = lastSeen && a.date > lastSeen ? 1 : 0;
      const bNew = lastSeen && b.date > lastSeen ? 1 : 0;
      if (aNew !== bNew) return bNew - aNew;
      return b.date.localeCompare(a.date);
    });
  }

  if (items.length === 0) {
    listEl.innerHTML = '<p id="status">No matching reports.</p>';
    return;
  }

  listEl.innerHTML = items
    .map((item) => {
      const isNew = lastSeen && item.date > lastSeen;
      return `
        <article class="card${isNew ? " is-new" : ""}">
          <div class="card-top">
            <span>${item.source}${item.disease ? " · " + escapeHtml(item.disease) : ""}</span>
            <span>${fmtDate(item.date)}${isNew ? '<span class="badge">New</span>' : ""}</span>
          </div>
          <h2><a href="${item.url}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a></h2>
          <p>${escapeHtml(item.summary)}</p>
        </article>
      `;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

async function init() {
  try {
    const res = await fetch("data/feed.json", { cache: "no-store" });
    const feed = await res.json();
    allItems = feed.items;
    metaEl.textContent = `${feed.count} reports from ${feed.sources.join(", ")} · updated ${fmtDate(feed.generated_at)}`;
    render();

    const newest = allItems.reduce((max, i) => (i.date > max ? i.date : max), "");
    if (newest) localStorage.setItem(LAST_SEEN_KEY, newest);
  } catch (err) {
    listEl.innerHTML = '<p id="status">Could not load feed. Try again shortly.</p>';
    console.error(err);
  }
}

searchEl.addEventListener("input", render);
sortEl.addEventListener("change", render);
init();
