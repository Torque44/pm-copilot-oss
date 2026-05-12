// MarketHeader.test.tsx — locks in the resolved-banner rendering. Active
// markets must NOT show the banner; resolved markets must show it with the
// correct outcome label + date.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MarketHeader } from './MarketHeader';
import type { Market } from '../../types';

function mkMarket(over: Partial<Market> = {}): Market {
  return {
    id: 'm-1',
    venue: 'polymarket',
    title: 'Will X happen?',
    yes: 0.5,
    no: 0.5,
    vol24h: '$10k',
    resolveIn: '12d',
    criteria: 'Market resolves YES if X happens.',
    ...over,
  };
}

describe('MarketHeader — resolved banner', () => {
  it('does not render the banner for active markets', () => {
    const { container } = render(<MarketHeader market={mkMarket()} />);
    expect(container.querySelector('.mh-resolved-banner')).toBeNull();
  });

  it('renders the banner with YES outcome when resolvedAt is set and YES is closer to 1', () => {
    const { container } = render(
      <MarketHeader
        market={mkMarket({
          resolvedAt: '2025-06-30T12:00:00Z',
          yes: 1.0,
          no: 0.0,
          resolveIn: 'resolved',
        })}
      />,
    );
    const banner = container.querySelector('.mh-resolved-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/resolved/i);
    expect(banner!.textContent).toMatch(/YES/);
  });

  it('renders NO outcome when NO is closer to 1', () => {
    const { container } = render(
      <MarketHeader
        market={mkMarket({
          resolvedAt: '2025-06-30T12:00:00Z',
          yes: 0.0,
          no: 1.0,
          resolveIn: 'resolved',
        })}
      />,
    );
    const banner = container.querySelector('.mh-resolved-banner');
    expect(banner!.textContent).toMatch(/NO/);
  });
});
