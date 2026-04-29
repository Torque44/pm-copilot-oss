// scroll-rail.js — modern scrollbar replacement for pm copilot
// hides native scrollbars; gives every scroll container a soft top/bottom
// fade mask + a thin right-edge progress rail that appears only while the
// user is actively scrolling (or hovering the container).

(function () {
  'use strict';

  const SELECTOR = [
    '.panel-body',
    '.event-list',
    '.rail-right',
    '.chat-history',
    '.palette-list',
    '.empty-state',
    '.mobile-fallback',
  ].join(',');

  const HIDE_DELAY = 700; // ms after scroll stops before rail fades
  const MAX_FADE = 16;    // px

  function attach(el) {
    if (el.__scrollRailAttached) return;
    el.__scrollRailAttached = true;

    // build rail
    const rail = document.createElement('div');
    rail.className = 'scroll-rail';
    const track = document.createElement('div');
    track.className = 'scroll-rail-track';
    const thumb = document.createElement('div');
    thumb.className = 'scroll-rail-thumb';
    rail.appendChild(track);
    rail.appendChild(thumb);
    el.appendChild(rail);

    let hideTimer = null;

    const update = () => {
      const sh = el.scrollHeight;
      const ch = el.clientHeight;
      const st = el.scrollTop;
      const overflow = sh - ch;

      if (overflow <= 1) {
        // no overflow: no rail, no fades
        rail.style.display = 'none';
        el.style.setProperty('--top-fade', '0px');
        el.style.setProperty('--bot-fade', '0px');
        return;
      }
      rail.style.display = 'block';

      // fade masks scaled by how close we are to top/bottom
      const topFade = Math.min(MAX_FADE, st);
      const botFade = Math.min(MAX_FADE, overflow - st);
      el.style.setProperty('--top-fade', topFade + 'px');
      el.style.setProperty('--bot-fade', botFade + 'px');

      // thumb size + position
      const railH = rail.clientHeight;
      const thumbH = Math.max(20, (ch / sh) * railH);
      const thumbTop = (st / overflow) * (railH - thumbH);
      thumb.style.height = thumbH + 'px';
      thumb.style.top = thumbTop + 'px';
    };

    const show = () => {
      rail.classList.add('visible');
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!el.matches(':hover') && !rail.classList.contains('dragging')) {
          rail.classList.remove('visible');
        }
      }, HIDE_DELAY);
    };

    el.addEventListener('scroll', () => { update(); show(); }, { passive: true });
    el.addEventListener('mouseenter', () => { update(); rail.classList.add('visible'); });
    el.addEventListener('mouseleave', () => {
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (!rail.classList.contains('dragging')) rail.classList.remove('visible');
      }, HIDE_DELAY);
    });

    // drag-to-scroll on the rail thumb
    let dragStartY = 0;
    let dragStartScroll = 0;
    const onMove = (e) => {
      const railH = rail.clientHeight;
      const sh = el.scrollHeight;
      const ch = el.clientHeight;
      const overflow = sh - ch;
      const thumbH = Math.max(20, (ch / sh) * railH);
      const dy = (e.clientY - dragStartY) * (overflow / (railH - thumbH));
      el.scrollTop = dragStartScroll + dy;
    };
    const onUp = () => {
      rail.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    thumb.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragStartY = e.clientY;
      dragStartScroll = el.scrollTop;
      rail.classList.add('dragging', 'visible');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // resize observer to keep things in sync
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(update);
      ro.observe(el);
    }

    update();
  }

  function scan(root) {
    (root || document).querySelectorAll(SELECTOR).forEach(attach);
  }

  // initial pass
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan());
  } else {
    scan();
  }

  // watch for new scroll containers (react re-renders, state switching)
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches(SELECTOR)) attach(n);
        if (n.querySelectorAll) scan(n);
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
