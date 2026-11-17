/** Register the staff (driver + admin) service worker in production only. */
export function registerOperatorServiceWorker(): void {
  if (import.meta.env.DEV) return;
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const path = window.location.pathname;
  if (!path.startsWith("/operator") && !path.startsWith("/admin")) return;

  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
    console.warn("[operator-pwa] service worker registration failed", err);
  });
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    nav.standalone === true ||
    window.matchMedia("(display-mode: minimal-ui)").matches
  );
}

export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
