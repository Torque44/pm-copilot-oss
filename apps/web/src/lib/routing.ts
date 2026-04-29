// routing.ts — minimal URL ↔ Route bridge using pushState + popstate.
//
// We intentionally avoid pulling in react-router; the app has a tiny route
// surface and benefits from keeping bundle weight low. The hook listens for
// popstate (browser back/forward) and dispatches a custom 'route:change' event
// for in-app navigations so multiple consumers stay in sync.

import { useCallback, useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'market'; marketId: string }
  | { name: 'event'; eventId: string }
  | { name: 'setup' }
  | { name: 'settings' };

const ROUTE_CHANGE_EVENT = 'route:change';

export function routeToPath(r: Route): string {
  switch (r.name) {
    case 'home':
      return '/';
    case 'market':
      return `/m/${encodeURIComponent(r.marketId)}`;
    case 'event':
      return `/event/${encodeURIComponent(r.eventId)}`;
    case 'setup':
      return '/setup';
    case 'settings':
      return '/settings';
  }
}

export function pathToRoute(path: string): Route {
  // Strip trailing slash (except root) and any querystring/hash for matching.
  let p = path.split('?')[0]?.split('#')[0] ?? '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);

  if (p === '' || p === '/') return { name: 'home' };
  if (p === '/setup') return { name: 'setup' };
  if (p === '/settings') return { name: 'settings' };

  const marketMatch = /^\/m\/([^/]+)$/.exec(p);
  if (marketMatch && marketMatch[1]) {
    return { name: 'market', marketId: decodeURIComponent(marketMatch[1]) };
  }

  const eventMatch = /^\/event\/([^/]+)$/.exec(p);
  if (eventMatch && eventMatch[1]) {
    return { name: 'event', eventId: decodeURIComponent(eventMatch[1]) };
  }

  return { name: 'home' };
}

function currentRoute(): Route {
  if (typeof window === 'undefined') return { name: 'home' };
  return pathToRoute(window.location.pathname);
}

export type UseRouteResult = {
  route: Route;
  navigate: (r: Route) => void;
  back: () => void;
};

export function useRoute(): UseRouteResult {
  const [route, setRoute] = useState<Route>(() => currentRoute());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onPop = () => setRoute(currentRoute());
    const onChange = () => setRoute(currentRoute());

    window.addEventListener('popstate', onPop);
    window.addEventListener(ROUTE_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener(ROUTE_CHANGE_EVENT, onChange);
    };
  }, []);

  const navigate = useCallback((r: Route) => {
    if (typeof window === 'undefined') return;
    const path = routeToPath(r);
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path);
    }
    setRoute(r);
    window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT));
  }, []);

  const back = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.history.back();
  }, []);

  return { route, navigate, back };
}
