// Football (soccer) results client — ESPN public site API.
// No auth required. Used by /api/football to back the "Recent Results" rail
// section on sports briefs. Intentionally NOT routed through the agents — it's
// purely contextual grounding for the reader, not input to the synthesis.

import { getJson } from './http';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// League slugs ESPN uses:
//   esp.1             = La Liga
//   uefa.champions    = UEFA Champions League
const LEAGUES = [
  { slug: 'esp.1', label: 'La Liga' },
  { slug: 'uefa.champions', label: 'UCL' },
] as const;

export type Game = {
  league: 'La Liga' | 'UCL';
  homeTeam: string;
  homeScore: number | null;
  awayTeam: string;
  awayScore: number | null;
  date: string;                  // ISO
  status: 'final' | 'live' | 'scheduled';
  statusDetail: string;          // e.g., "Full Time", "HT", "90+3'"
  link?: string;
};

// ESPN's response shape is loose; we narrow at the call site via toGame().
type EspnCompetitor = {
  homeAway?: 'home' | 'away';
  team?: { shortDisplayName?: string; name?: string; abbreviation?: string };
  score?: string | number;
};
type EspnEvent = {
  date?: string;
  status?: { type?: { state?: string; shortDetail?: string; description?: string } };
  competitions?: { competitors?: EspnCompetitor[] }[];
  links?: { href?: string }[];
};

async function get<T>(url: string): Promise<T> {
  return getJson<T>(url);
}

function ymd(d: Date): string {
  const y = d.getFullYear().toString();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

function toGame(league: Game['league'], ev: EspnEvent): Game | null {
  try {
    const comp = ev?.competitions?.[0];
    if (!comp) return null;
    const competitors = comp.competitors ?? [];
    const home = competitors.find((c) => c.homeAway === 'home');
    const away = competitors.find((c) => c.homeAway === 'away');
    if (!home?.team || !away?.team) return null;

    const state = ev?.status?.type?.state ?? '';
    const status: Game['status'] =
      state === 'post' ? 'final' : state === 'in' ? 'live' : 'scheduled';

    const homeName = home.team.shortDisplayName ?? home.team.name ?? home.team.abbreviation;
    const awayName = away.team.shortDisplayName ?? away.team.name ?? away.team.abbreviation;
    if (!homeName || !awayName || !ev.date) return null;

    return {
      league,
      homeTeam: homeName,
      homeScore: home.score != null ? Number(home.score) : null,
      awayTeam: awayName,
      awayScore: away.score != null ? Number(away.score) : null,
      date: ev.date,
      status,
      statusDetail: ev?.status?.type?.shortDetail ?? ev?.status?.type?.description ?? '',
      link: ev?.links?.[0]?.href,
    };
  } catch {
    return null;
  }
}

type FetchOpts = {
  /** When "upcoming" (default): prefer scheduled + live games in next 21 days. "recent": finished games in last 21 days. "mixed": both. */
  mode?: 'upcoming' | 'recent' | 'mixed';
  limit?: number;
};

export async function getFootball({ mode = 'upcoming', limit = 20 }: FetchOpts = {}): Promise<Game[]> {
  const now = new Date();
  const past = new Date(now);
  past.setDate(past.getDate() - 21);
  const future = new Date(now);
  future.setDate(future.getDate() + 21);

  // ESPN accepts a single dates range per call; query the full window then filter.
  const datesParam = `${ymd(past)}-${ymd(future)}`;

  const perLeague = await Promise.all(
    LEAGUES.map(async (l) => {
      try {
        const data = await get<{ events?: EspnEvent[] }>(`${ESPN}/${l.slug}/scoreboard?dates=${datesParam}`);
        const games = (data.events ?? [])
          .map((e) => toGame(l.label, e))
          .filter((g): g is Game => g != null);
        return games;
      } catch {
        return [] as Game[];
      }
    })
  );

  const all = perLeague.flat();

  // Split buckets
  const finished = all.filter((g) => g.status === 'final');
  const live = all.filter((g) => g.status === 'live');
  const scheduled = all
    .filter((g) => g.status === 'scheduled')
    // Scheduled games should be in the future, not a date-parsing edge case in the past.
    .filter((g) => new Date(g.date).getTime() >= now.getTime() - 60 * 60 * 1000);

  let out: Game[];
  if (mode === 'upcoming') {
    // Live first, then scheduled ordered nearest-kickoff first. Drop finished.
    const liveSorted = live.sort(byDateAsc);
    const scheduledSorted = scheduled.sort(byDateAsc);
    out = [...liveSorted, ...scheduledSorted];
  } else if (mode === 'recent') {
    out = [...finished.sort(byDateDesc), ...live.sort(byDateDesc)];
  } else {
    out = [
      ...live.sort(byDateAsc),
      ...scheduled.sort(byDateAsc),
      ...finished.sort(byDateDesc),
    ];
  }

  return out.slice(0, limit);
}

function byDateAsc(a: Game, b: Game): number {
  return new Date(a.date).getTime() - new Date(b.date).getTime();
}
function byDateDesc(a: Game, b: Game): number {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}
