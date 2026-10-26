/**
 * Does this browser let an iframe's `color-scheme` decide the embedded page's
 * `prefers-color-scheme`? The preview's Light / Dark control relies on it.
 * Safari before 27 doesn't (WebKit bug 284973): its iframes always follow the
 * system setting.
 *
 * Checked once per page load with two hidden iframes holding a tiny page of
 * our own (never agent HTML): one dark, one light. Support means only the dark
 * one matches, which also holds when the system itself is dark.
 *
 * DevTools' "emulate prefers-color-scheme" forces the value in every frame,
 * so with it on this reports no support. That only affects testing.
 */
let result: Promise<boolean> | null = null;

export function colorSchemeSupport(): Promise<boolean> {
  result ??= Promise.all([probe("dark"), probe("light")])
    .then(([dark, light]) => dark && !light)
    // If the check can't run, assume support rather than show a wrong note.
    .catch(() => true);
  return result;
}

function probe(scheme: "dark" | "light"): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = `position:absolute;width:1px;height:1px;left:-9999px;border:0;color-scheme:${scheme}`;
    frame.onload = () => {
      try {
        resolve(frame.contentWindow?.matchMedia("(prefers-color-scheme: dark)").matches ?? false);
      } catch (e) {
        reject(e);
      } finally {
        frame.remove();
      }
    };
    // Same origin and script-free, so the parent can read its matchMedia.
    frame.srcdoc = "<!doctype html><title>color-scheme check</title>";
    document.body.append(frame);
  });
}
