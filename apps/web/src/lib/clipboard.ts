/**
 * Puts text on the clipboard, and says whether it worked.
 *
 * `navigator.clipboard` only exists on a secure page (https, or localhost). A game
 * served from a plain http address, which is what a first deployment on a bare IP
 * is, has no such API, so a Copy button written only against it silently does
 * nothing. The older `execCommand` route works anywhere a person has just tapped.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* refused (a permission, an unfocused page): try the older way */
  }

  const box = document.createElement('textarea')
  try {
    box.value = text
    box.setAttribute('readonly', '')
    box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none'
    // Inside an open sheet the page traps focus, so the box has to live in it too.
    const host = (document.activeElement as HTMLElement | null)?.closest('[role="dialog"]') ?? document.body
    host.appendChild(box)
    box.select()
    box.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    box.remove()
  }
}

/** Whether the person dismissed the share sheet rather than something going wrong. */
export function isDismissal(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
