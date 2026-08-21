export function openOptionsPageFromContent(
  getUrl: unknown = chrome.runtime.getURL,
  openWindow: (url: string, target: string, features: string) => unknown = window.open.bind(window)
): void {
  const resolveUrl =
    typeof getUrl === 'function' ? (getUrl as (path: string) => string) : chrome.runtime.getURL
  openWindow(resolveUrl('src/options/index.html'), '_blank', 'noopener')
}
