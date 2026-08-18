const LAST_SEEN_KEY = "outbreak-watch:last-seen";
const OPEN_KEY_PREFIX = "outbreak-watch:open:";

const listEl = document.getElementById("list");
const metaEl = document.getElementById("meta");
const searchEl = document.getElementById("search");
const sortEl = document.getElementById("sort");

let allOutbreaks = [];
let lastSeen = localStorage.getItem(LAST_SEEN_KEY);

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  let outbreaks = allOutbreaks.filter((ob) => {
    if (!query) return true;
    const haystack = `${ob.disease} ${ob.updates.map((u) => u.title + " " + u.summary).join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });

  const isNewOutbreak = (ob) => lastSeen && ob.latest_update > lastSeen;

  if (sortEl.value === "unread") {
    outbreaks = [...outbreaks].sort((a, b) => {
      const aNew = isNewOutbreak(a) ? 1 : 0;
      const bNew = isNewOutbreak(b) ? 1 : 0;
      if (aNew !== bNew) return bNew - aNew;
      return b.latest_update.localeCompare(a.latest_update);
    });
  } else if (sortEl.value === "count") {
    outbreaks = [...outbreaks].sort((a, b) => b.update_count - a.update_count);
  }

  if (outbreaks.length === 0) {
    listEl.innerHTML = '<p id="status">No matching outbreaks.</p>';
    return;
  }

  listEl.innerHTML = outbreaks
    .map((ob) => {
      const isNew = isNewOutbreak(ob);
      const isOpen = sessionStorage.getItem(OPEN_KEY_PREFIX + ob.id) === "1";
      const updatesHtml = ob.updates
        .map(
          (u) => `
            <div class="update">
              <div class="update-date">${fmtDate(u.date)}</div>
              <h3><a href="${u.url}" target="_blank" rel="noopener">${escapeHtml(u.title)}</a></h3>
              <p>${escapeHtml(u.summary)}</p>
            </div>
          `
        )
        .join("");

      return `
        <article class="outbreak${isNew ? " is-new" : ""}${isOpen ? " is-open" : ""}" data-id="${escapeHtml(ob.id)}">
          <button class="outbreak-head" type="button">
            <div>
              <div class="outbreak-title">${escapeHtml(ob.disease)}</div>
              <div class="outbreak-meta">
                <span class="chip">${ob.update_count} update${ob.update_count === 1 ? "" : "s"}</span>
                <span>first seen ${fmtDate(ob.first_seen)}</span>
                <span>·</span>
                <span>latest ${fmtDate(ob.latest_update)}</span>
                ${isNew ? '<span class="badge">New</span>' : ""}
              </div>
            </div>
            <span class="chevron">▶</span>
          </button>
          <div class="timeline">${updatesHtml}</div>
        </article>
      `;
    })
    .join("");

  listEl.querySelectorAll(".outbreak-head").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".outbreak");
      const id = card.dataset.id;
      const nowOpen = !card.classList.contains("is-open");
      card.classList.toggle("is-open", nowOpen);
      if (nowOpen) sessionStorage.setItem(OPEN_KEY_PREFIX + id, "1");
      else sessionStorage.removeItem(OPEN_KEY_PREFIX + id);
    });
  });
}

async function init() {
  try {
    const res = await fetch("data/feed.json", { cache: "no-store" });
    const feed = await res.json();
    allOutbreaks = feed.outbreaks;
    metaEl.textContent = `${feed.outbreak_count} outbreaks (${feed.update_count} reports) from ${feed.sources.join(", ")} · updated ${fmtDate(feed.generated_at)}`;
    render();

    const newest = allOutbreaks.reduce((max, o) => (o.latest_update > max ? o.latest_update : max), "");
    if (newest) localStorage.setItem(LAST_SEEN_KEY, newest);
  } catch (err) {
    listEl.innerHTML = '<p id="status">Could not load feed. Try again shortly.</p>';
    console.error(err);
  }
}

searchEl.addEventListener("input", render);
sortEl.addEventListener("change", render);
init();
