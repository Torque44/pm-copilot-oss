// agent specialists, in the order described in the brief
window.AGENTS = [
  { key: 'market',     label: 'market'     },
  { key: 'holders',    label: 'holders'    },
  { key: 'news',       label: 'news'       },
  { key: 'thesis',     label: 'thesis'     },
  { key: 'calibrator', label: 'calibrator' },
  { key: 'risk',       label: 'risk'       },
  { key: 'reporter',   label: 'reporter'   },
];

// illustrative seed data — NOT real
window.MARKETS = {
  btc100k: {
    id: 'btc100k',
    venue: 'polymarket',
    title: 'btc at $100k by eoy 2026',
    yes: 0.62, no: 0.39, vol24h: '$3.24M', resolveIn: '14d 6h',
    criteria: 'resolves YES if any major exchange (coinbase, binance, kraken) prints a btc/usd trade ≥ $100,000 between 2026-01-01 and 2026-12-31 utc.',
    multi: false,
  },
  dem2028: {
    id: 'dem2028',
    venue: 'polymarket',
    title: '2028 democratic nominee for president',
    vol24h: '$8.71M', resolveIn: '~30 months',
    criteria: 'resolves YES on the candidate who receives the democratic party nomination at the 2028 dnc.',
    multi: true,
    outcomes: [
      { name: 'gavin newsom',     yes: 0.21, no: 0.81 },
      { name: 'pete buttigieg',   yes: 0.14, no: 0.88 },
      { name: 'gretchen whitmer', yes: 0.11, no: 0.91 },
      { name: 'josh shapiro',     yes: 0.09, no: 0.93 },
      { name: 'kamala harris',    yes: 0.08, no: 0.94 },
    ],
    moreCount: 30,
  },
};
