// citationFlash.ts — citation pill flash + scroll-rail / fade-edge plumbing.
//
// Ported from design-bundle/research-desk/scroll-rail.js with two changes:
//   1. The flash trigger is split out into `flashCitation(id)` so the inline
//      brief panel can call it on pill click.
//   2. The auto-attach MutationObserver is replaced by explicit attach helpers
//      (attachScrollRail / attachFadeEdges) which return cleanup functions —
//      this fits React's mount/unmount lifecycle better.
//
// CSS contract (matches design-bundle/research-desk/styles.css):
//   - `.scroll-rail` is the rail element appended to the panel.
//   - The rail visually owns its own thumb via CSS variables:
//        --scroll-progress  : 0..1
//        --scroll-thumb-h   : px (height of the thumb)
//   - Fade-edge containers consume:
//        --fade-top         : px
//        --fade-bottom      : px
//   - A `#src-{id}` element gains the `.flash` class on flashCitation; the
//     existing keyframes animation will re-trigger once the class re-attaches.

const FLASH_CLASS = 'flash';
const RAIL_CLASS = 'scroll-rail';
const RAIL_VISIBLE_CLASS = 'visible';
const HIDE_DELAY_MS = 700;
const MAX_FADE_PX = 16;

/** Re-flash a citation pill. Removes the class on the next frame, re-adds it
 *  the frame after — this restarts the CSS animation so re-clicking the same
 *  citation visibly pulses again. Also scrolls the pill into the nearest
 *  scrolling ancestor. */
export function flashCitation(id: string): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(`src-${id}`);
  if (!el) return;

  el.classList.remove(FLASH_CLASS);
  // Two RAFs to guarantee the browser observes the class-removed state before
  // re-adding the class — single rAF can be coalesced.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.add(FLASH_CLASS);
    });
  });

  // Scroll the citation into view, but only as much as needed.
  try {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  } catch {
    // Older browsers without smooth-scroll fall back to instant.
    el.scrollIntoView();
  }
}

type CleanupFn = () => void;

/** Attach a soft progress rail to a scrollable panel. Returns a cleanup fn
 *  that removes listeners + the rail element. Idempotent: calling twice on
 *  the same element returns separate cleanups but only the first attaches a
 *  rail (subsequent calls return a no-op). */
export function attachScrollRail(panelEl: HTMLElement): CleanupFn {
  if (typeof window === 'undefined' || !panelEl) return () => {};
  const ATTACHED_FLAG = '__scrollRailAttached';
  const flagged = panelEl as HTMLElement & { [ATTACHED_FLAG]?: boolean };
  if (flagged[ATTACHED_FLAG]) return () => {};
  flagged[ATTACHED_FLAG] = true;

  const rail = document.createElement('div');
  rail.className = RAIL_CLASS;
  panelEl.appendChild(rail);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const update = () => {
    const sh = panelEl.scrollHeight;
    const ch = panelEl.clientHeight;
    const st = panelEl.scrollTop;
    const overflow = sh - ch;
    if (overflow <= 1) {
      rail.style.display = 'none';
      panelEl.style.setProperty('--scroll-progress', '0');
      panelEl.style.setProperty('--scroll-thumb-h', '0px');
      return;
    }
    rail.style.display = 'block';
    const railH = rail.clientHeight;
    const thumbH = Math.max(20, (ch / sh) * railH);
    const progress = overflow > 0 ? st / overflow : 0;
    panelEl.style.setProperty('--scroll-progress', String(progress));
    panelEl.style.setProperty('--scroll-thumb-h', `${thumbH}px`);
  };

  const show = () => {
    rail.classList.add(RAIL_VISIBLE_CLASS);
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!panelEl.matches(':hover')) rail.classList.remove(RAIL_VISIBLE_CLASS);
    }, HIDE_DELAY_MS);
  };

  const onScroll = () => {
    update();
    show();
  };
  const onEnter = () => {
    update();
    rail.classList.add(RAIL_VISIBLE_CLASS);
  };
  const onLeave = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => rail.classList.remove(RAIL_VISIBLE_CLASS), HIDE_DELAY_MS);
  };

  panelEl.addEventListener('scroll', onScroll, { passive: true });
  panelEl.addEventListener('mouseenter', onEnter);
  panelEl.addEventListener('mouseleave', onLeave);

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(update);
    ro.observe(panelEl);
  }

  update();

  return () => {
    panelEl.removeEventListener('scroll', onScroll);
    panelEl.removeEventListener('mouseenter', onEnter);
    panelEl.removeEventListener('mouseleave', onLeave);
    if (hideTimer) clearTimeout(hideTimer);
    if (ro) ro.disconnect();
    if (rail.parentNode === panelEl) panelEl.removeChild(rail);
    flagged[ATTACHED_FLAG] = false;
  };
}

/** Attach CSS-var driven top/bottom fade edges to a scrollable element. The
 *  consuming CSS is expected to read `--fade-top` and `--fade-bottom` as px
 *  values for its mask-image gradient. */
export function attachFadeEdges(scrollEl: HTMLElement): CleanupFn {
  if (typeof window === 'undefined' || !scrollEl) return () => {};

  const update = () => {
    const sh = scrollEl.scrollHeight;
    const ch = scrollEl.clientHeight;
    const st = scrollEl.scrollTop;
    const overflow = sh - ch;
    if (overflow <= 1) {
      scrollEl.style.setProperty('--fade-top', '0px');
      scrollEl.style.setProperty('--fade-bottom', '0px');
      return;
    }
    const topFade = Math.min(MAX_FADE_PX, st);
    const botFade = Math.min(MAX_FADE_PX, overflow - st);
    scrollEl.style.setProperty('--fade-top', `${topFade}px`);
    scrollEl.style.setProperty('--fade-bottom', `${botFade}px`);
  };

  const onScroll = () => update();
  scrollEl.addEventListener('scroll', onScroll, { passive: true });

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(update);
    ro.observe(scrollEl);
  }

  update();

  return () => {
    scrollEl.removeEventListener('scroll', onScroll);
    if (ro) ro.disconnect();
    scrollEl.style.removeProperty('--fade-top');
    scrollEl.style.removeProperty('--fade-bottom');
  };
}
