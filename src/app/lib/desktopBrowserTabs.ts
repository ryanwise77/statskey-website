const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i
const HOST_LIKE = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[a-f\d:]+\]|[^\s/]+\.[^\s/]+)(?::\d+)?(?:\/|$)/i

/** Turns an address-bar value into a safe browser destination or a web search. */
export function browserDestination(rawValue: string): string | null {
  const value = rawValue.trim()
  if (!value) return null
  if (HOST_LIKE.test(value)) {
    const local = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(
      value
    )
    return `${local ? 'http' : 'https'}://${value}`
  }
  if (URL_SCHEME.test(value)) return value
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`
}

export function browserDisplayHost(url: string | null): string {
  if (!url) return 'New tab'
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}
