// Source registry — curated allowlists per market sub-category for news
// domains and X handles. Used by the news + sentiment agents to filter
// model output: items from non-allowlisted sources get an `unverified`
// flag, items from the global denylist (Wikipedia + mirrors) are dropped.
//
// The lists are deliberately conservative. Adding a source means it's
// trader-grade neutral or domain-authoritative, not just "popular." User
// can amend over time. Wikipedia stays banned because it's user-editable
// and PM traders need information that can't be doctored mid-trade.

/** Sub-category a market falls into for source-routing purposes.
 *  Polymarket's top-level categories are crypto/sports/politics/other —
 *  but a "politics" event about Iran wants different sources than one about
 *  the Fed, so we split further at agent-time via classifyMarket(). */
export type MarketSubcategory =
  | 'crypto'
  | 'sports'
  | 'politics'        // domestic US politics, elections, legislation
  | 'geopolitics'     // international — Iran/Ukraine/China/etc.
  | 'macro'           // Fed, CPI, GDP, rates, central banks
  | 'tech'            // AI / chips / Big Tech earnings
  | 'other';

export type SourceProfile = {
  /** Allowed news/data domains. Items returned with these domains are
   *  treated as verified citations. */
  domains: string[];
  /** Authoritative X handles for this sub-category — sentiment agent
   *  prefers these. Includes officials, journalists, analysts, NOT random
   *  retail commentary. */
  handles: string[];
  /** Optional one-line guidance the agent system prompt embeds. */
  hint: string;
};

/** Globally banned. Never cited. Drops happen silently. */
export const DENYLIST_DOMAINS: ReadonlySet<string> = new Set([
  'wikipedia.org',
  'en.wikipedia.org',
  'wikitia.com',
  'wikiwand.com',
  'everipedia.com',
  'fandom.com',           // also user-editable
  'wikidata.org',
  'simple.wikipedia.org',
  'medium.com',           // open posting
  'substack.com',         // open posting (individual newsletters can be excellent but the platform is open)
  'reddit.com',
  'old.reddit.com',
  '4chan.org',
  'quora.com',
  'yahoo.com',            // mostly aggregator, low trust
  'forbes.com',           // contributor model, low trust per article
]);

const COMMON_NEUTRAL_NEWS = [
  'reuters.com',
  'apnews.com',
  'bloomberg.com',
  'wsj.com',
  'ft.com',
  'nytimes.com',
  'washingtonpost.com',
];

const COMMON_NEUTRAL_HANDLES = [
  'AP', 'Reuters', 'business', 'ReutersBiz',
  'nytimes', 'washingtonpost', 'WSJ', 'FT',
];

const PROFILES: Record<MarketSubcategory, SourceProfile> = {
  crypto: {
    domains: [
      ...COMMON_NEUTRAL_NEWS,
      'theblock.co', 'coindesk.com', 'decrypt.co', 'cointelegraph.com',
      'theinformation.com',
      // exchanges (official announcements):
      'binance.com', 'coinbase.com', 'kraken.com', 'okx.com', 'bitfinex.com', 'bybit.com',
      // on-chain data:
      'glassnode.com', 'santiment.net', 'defillama.com',
      'etherscan.io', 'solscan.io', 'bscscan.com', 'arbiscan.io',
      'dune.com', 'nansen.ai', 'arkhamintelligence.com',
      // protocol foundations:
      'ethereum.org', 'bitcoin.org', 'solana.com', 'arbitrum.io', 'optimism.io',
    ],
    handles: [
      ...COMMON_NEUTRAL_HANDLES,
      'WuBlockchain', 'TheBlock__', 'CoinDesk', 'decryptmedia',
      'VitalikButerin', 'cz_binance', 'brian_armstrong',
      'APompliano', 'aantonop', '100trillionUSD',
      'whale_alert', 'lookonchain', 'nansen_ai', 'glassnode', 'santimentfeed',
      'DefiIgnas', 'hosseeb', 'RyanWatkins_', 'CryptoCobain', 'AltcoinGordon',
      'arkham', 'punk6529', 'BitMEXResearch',
    ],
    hint: 'crypto markets — favor on-chain analysts (glassnode, lookonchain, whale_alert), exchange CEOs only for direct announcements, core devs (vitalik), and trade press (theblock.co, coindesk.com). Skip influencer hype.',
  },

  sports: {
    domains: [
      'espn.com', 'theathletic.com', 'si.com', 'cbssports.com', 'bleacherreport.com',
      'foxsports.com', 'nbcsports.com', 'pff.com',
      // leagues:
      'nfl.com', 'nba.com', 'mlb.com', 'nhl.com', 'pgatour.com', 'wta.com', 'atptour.com',
      'fifa.com', 'uefa.com', 'olympics.com',
      // betting / data:
      'actionnetwork.com', 'sportradar.com', 'pinnacle.com',
    ],
    handles: [
      'AdamSchefter', 'ShamsCharania', 'wojespn',           // NFL + NBA insiders
      'Ken_Rosenthal', 'JeffPassan',                          // MLB
      'FabrizioRomano', 'David_Ornstein',                     // soccer transfers
      'TheAthletic', 'espn', 'SportsCenter', 'bleacherreport',
      'ESPNStatsInfo', 'CBSSportsHQ', 'FOXSports',
      'PFF', 'JonBois', 'NSandsportsbiz',
    ],
    hint: 'sports markets move on injuries + insider scoops. Stick to verified beat reporters (Schefter, Shams, Rosenthal, Romano) and team/league official accounts. No retail predictors.',
  },

  politics: {
    domains: [
      ...COMMON_NEUTRAL_NEWS,
      'politico.com', 'axios.com', 'thehill.com', 'nbcnews.com',
      'punchbowl.news', 'puck.news', 'realclearpolitics.com',
      'cookpolitical.com', 'centerforpolitics.org',
      'silverbulletin.com', '538.com',
      // official:
      'whitehouse.gov', 'congress.gov', 'senate.gov', 'house.gov',
      'fec.gov', 'state.gov', 'supremecourt.gov', 'gao.gov', 'cbo.gov',
    ],
    handles: [
      ...COMMON_NEUTRAL_HANDLES,
      'politico', 'axios', 'PunchbowlNews', 'puckdotnews',
      'MaggieNYT', 'SahilKapur', 'JakeSherman', 'AnnaPalmerDC',
      'nateSilver538', 'CookPolitical', 'larrysabato',
      'WhiteHouse', 'POTUS', 'VP',
      'SenateGOP', 'SenateDems', 'HouseGOP', 'HouseDemocrats',
    ],
    hint: 'US politics — favor neutral wires + DC-beat reporters (Punchbowl, Politico, Axios, NYT, WaPo). Forecasters: Silver, Cook, Sabato. Official .gov for primary source. Skip partisan commentary outlets.',
  },

  geopolitics: {
    domains: [
      ...COMMON_NEUTRAL_NEWS,
      'bbc.com', 'aljazeera.com',
      'economist.com', 'foreignpolicy.com', 'foreignaffairs.com',
      // think tanks (high-credibility analysis):
      'cfr.org', 'brookings.edu', 'atlanticcouncil.org',
      'carnegieendowment.org', 'csis.org', 'rand.org',
      'iiss.org', 'chathamhouse.org', 'crisisgroup.org',
      // regional / specialist:
      'al-monitor.com', 'iranintl.com', 'tehrantimes.com',
      'kyivindependent.com', 'haaretz.com', 'timesofisrael.com',
      'scmp.com',
      // official:
      'state.gov', 'defense.gov', 'un.org', 'nato.int',
      // India press (also covers Asia geopolitics well):
      'thehindu.com', 'livemint.com', 'economictimes.indiatimes.com', 'business-standard.com',
    ],
    handles: [
      ...COMMON_NEUTRAL_HANDLES,
      'BBCWorld', 'AlJazeera', 'TheEconomist',
      'CFR_org', 'BrookingsInst', 'AtlanticCouncil',
      'CarnegieEndow', 'CSIS', 'RANDCorporation', 'IISS_org',
      'StateDept', 'WhiteHouse', 'DeptofDefense',
      'UN', 'NATO', 'EUCouncil',
      // topic specialists:
      'karim_sadjadpour', 'TrtaParsi',                 // Iran
      'AnneApplebaum', 'TimothyDSnyder',                // Eastern Europe
      'Maria_Drutska', 'IAPonomarenko',                 // Ukraine
      'AlMonitor', 'IranIntl', 'AmwajMediaEN',
      // Indian media:
      'the_hindu', 'livemint', 'EconomicTimes',
    ],
    hint: 'international/geopolitics — official .gov & foreign-ministry handles, established news (Reuters, AP, BBC, FT), think tanks (CFR, Brookings, Carnegie, RAND), and named regional specialists. Skip Twitter pundits without subject-matter expertise.',
  },

  macro: {
    domains: [
      'federalreserve.gov', 'bls.gov', 'bea.gov', 'treasury.gov',
      'imf.org', 'worldbank.org',
      'ecb.europa.eu', 'bankofengland.co.uk',
      'reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'cnbc.com',
      'apollo.com',                                       // Apollo macro research
      'pictet.com', 'pimco.com',                          // institutional macro shops
    ],
    handles: [
      'federalreserve', 'neelkashkari',
      'nickTimiraos',                                     // WSJ Fed whisperer
      'SteveLiesman',                                     // CNBC Fed reporter
      'biancoresearch', 'LizAnnSonders',
      'JeffreyKleintop', 'MohamedAElErian',
      'business', 'ReutersBiz', 'wsj',
      'profplum99', 'TheStalwart',                        // Bloomberg's Joe Weisenthal
    ],
    hint: 'macro/Fed — primary source = federalreserve.gov + bls.gov + bea.gov. WSJ Fed reporter Nick Timiraos historically front-runs Fed decisions. Bloomberg/Reuters/CNBC for fast moves. Avoid "Fed pivot" Twitter speculators.',
  },

  tech: {
    domains: [
      'bloomberg.com', 'reuters.com', 'wsj.com', 'ft.com',
      'theinformation.com', 'stratechery.com', 'axios.com',
      'wired.com', 'theverge.com', 'arstechnica.com', 'techcrunch.com',
      // company official:
      'anthropic.com', 'openai.com', 'x.ai', 'deepmind.google',
      'about.meta.com', 'blog.google', 'microsoft.com',
      'apple.com/newsroom', 'aboutamazon.com', 'about.netflix.com',
      'nvidia.com', 'amd.com', 'intel.com', 'tsmc.com',
      // SEC filings:
      'sec.gov',
    ],
    handles: [
      'sama', 'elonmusk', 'demishassabis', 'ilyasut', 'gdb', 'karpathy',
      'AnthropicAI', 'OpenAI', 'xai', 'GoogleDeepMind',
      'MiraMurati', 'JeffDean',
      'SemiAnalysis_',                                     // Dylan Patel (chips)
      'balajis', 'theinformation', 'stratechery', 'cwhowell',
      'satyanadella', 'tim_cook',
      'jasonlk', 'gergelyorosz',
    ],
    hint: 'tech/AI — official company blogs first (anthropic.com, openai.com, x.ai, nvidia.com), then The Information / Stratechery for analysis. Founder accounts (sama, elonmusk, demishassabis) when they personally announce. Dylan Patel for chip supply.',
  },

  other: {
    domains: [
      ...COMMON_NEUTRAL_NEWS,
      'bbc.com', 'theguardian.com',
    ],
    handles: COMMON_NEUTRAL_HANDLES,
    hint: 'fall back to neutral wire services (Reuters, AP, Bloomberg, WSJ, FT, NYT, WaPo, BBC). No subcategory profile applies.',
  },
};

/** Get the curated source profile for a sub-category. */
export function profileFor(sub: MarketSubcategory): SourceProfile {
  return PROFILES[sub];
}

/**
 * Classify a market into a finer sub-category than Polymarket's broad
 * crypto/sports/politics/other. Heuristic only — keyword regex on the title.
 * Falls through to the original category if nothing specific matches.
 */
export function classifyMarket(category: string, title: string): MarketSubcategory {
  const t = (title || '').toLowerCase();
  const c = (category || '').toLowerCase();

  // politics → split into geopolitics/macro/politics
  if (c === 'politics') {
    if (/\b(iran|israel|palestin|gaza|ukraine|russia|china|taiwan|nato|gaza|hezbollah|hamas|saudi|venezuela|north korea|nuclear deal|peace deal|ceasefire|war|sanction|tariff)\b/.test(t)) {
      return 'geopolitics';
    }
    if (/\b(fed|fomc|cpi|ppi|gdp|jobs|unemployment|nfp|rate cut|rate hike|interest rate|inflation|recession|powell|treasury|yield)\b/.test(t)) {
      return 'macro';
    }
    return 'politics';
  }

  // other → tech if AI/chip/big-tech keywords
  if (c === 'other') {
    if (/\b(ai|llm|gpt|claude|gemini|grok|openai|anthropic|nvidia|amd|chip|semiconductor|tsmc|apple|google|meta|microsoft|netflix|tesla|amazon)\b/.test(t)) {
      return 'tech';
    }
    return 'other';
  }

  if (c === 'crypto') return 'crypto';
  if (c === 'sports') return 'sports';
  return 'other';
}

/**
 * Hostname → "is this domain banned?" (silent drop).
 */
export function isDenylisted(urlOrDomain: string): boolean {
  const host = extractHost(urlOrDomain);
  if (!host) return false;
  if (DENYLIST_DOMAINS.has(host)) return true;
  // Also block any subdomain of a banned root.
  for (const banned of DENYLIST_DOMAINS) {
    if (host.endsWith(`.${banned}`)) return true;
  }
  return false;
}

/**
 * Hostname → "is this domain in the allowlist for this sub-category?"
 * Items that fail this AND aren't on the denylist get an `unverified` flag
 * (still shown to the user, but tagged so they can apply judgment).
 */
export function isAllowlisted(sub: MarketSubcategory, urlOrDomain: string): boolean {
  const host = extractHost(urlOrDomain);
  if (!host) return false;
  const profile = PROFILES[sub];
  for (const allowed of profile.domains) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  // Treat the global "neutral wire" set as allowed for any sub-category.
  for (const allowed of COMMON_NEUTRAL_NEWS) {
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/**
 * Handle (with or without @) → "is this handle in the X allowlist for this
 * sub-category?" Sentiment agent uses this to filter quoted citations.
 */
export function isAllowlistedHandle(sub: MarketSubcategory, handle: string): boolean {
  const h = (handle || '').replace(/^@/, '').toLowerCase();
  if (!h) return false;
  const profile = PROFILES[sub];
  for (const allowed of profile.handles) {
    if (allowed.toLowerCase() === h) return true;
  }
  return false;
}

function extractHost(urlOrDomain: string): string | null {
  if (!urlOrDomain) return null;
  let raw = urlOrDomain.trim().toLowerCase();
  if (!raw) return null;
  // Strip protocol if present.
  raw = raw.replace(/^https?:\/\//, '');
  // Take the host portion (drop path/query).
  const slash = raw.indexOf('/');
  if (slash >= 0) raw = raw.slice(0, slash);
  // Drop leading www.
  raw = raw.replace(/^www\./, '');
  // Drop port.
  const colon = raw.indexOf(':');
  if (colon >= 0) raw = raw.slice(0, colon);
  return raw || null;
}
