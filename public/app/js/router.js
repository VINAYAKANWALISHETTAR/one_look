/** Hash router. Keeps deep links working inside a WebView (no server routes). */

const routes = new Map();
let notFound = null;

export function register(path, render) {
  routes.set(path, render);
}

export function setFallback(render) {
  notFound = render;
}

export function parse() {
  const raw = window.location.hash.replace(/^#/, "") || "/home";
  const [path, query = ""] = raw.split("?");
  return { path: path || "/home", params: new URLSearchParams(query) };
}

export function navigate(path) {
  if (window.location.hash === `#${path}`) {
    resolve();
    return;
  }
  window.location.hash = path;
}

export async function resolve() {
  const { path, params } = parse();
  const render = routes.get(path) || notFound;
  if (render) await render({ path, params });
}

/** Attaches the hashchange listener without rendering immediately. */
export function listen(guard) {
  window.addEventListener("hashchange", () => {
    if (typeof guard === "function" && !guard()) return;
    resolve();
  });
}

export function start() {
  listen();
  return resolve();
}
