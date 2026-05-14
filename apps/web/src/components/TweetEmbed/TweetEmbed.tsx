// TweetEmbed — drop-in social proof block that renders an X (Twitter)
// post natively via Twitter's official widgets.js loader.
//
// The script tag is added once at the document level; subsequent
// instances re-trigger widget rendering via twttr.widgets.load() so
// repeat renders (route changes, modal mounts) still resolve.
//
// We use twitter.com URLs (not x.com) because widgets.js is still
// keyed on the legacy hostname; an x.com href silently fails to
// resolve into an embed.

import { useEffect, useRef } from 'react';

const SCRIPT_ID = 'twitter-wjs';
const SCRIPT_SRC = 'https://platform.twitter.com/widgets.js';

declare global {
  interface Window {
    twttr?: {
      widgets?: {
        load?: (target?: HTMLElement) => void;
      };
    };
  }
}

export interface TweetEmbedProps {
  /** X handle without the @, e.g. "0xayushya". */
  handle: string;
  /** Numeric status id. */
  tweetId: string;
  /** Optional override; defaults to "dark" to match the desk theme. */
  theme?: 'light' | 'dark';
  /** Hide the parent reply chain ("data-conversation=none"). Defaults true. */
  hideConversation?: boolean;
}

export function TweetEmbed({
  handle,
  tweetId,
  theme = 'dark',
  hideConversation = true,
}: TweetEmbedProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // 1. Ensure the widgets.js script is on the page (once).
    if (!document.getElementById(SCRIPT_ID)) {
      const script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.charset = 'utf-8';
      document.body.appendChild(script);
    }

    // 2. If already loaded (route re-mount), trigger widget render
    //    scoped to our wrapper so we don't re-scan the whole DOM.
    const loader = window.twttr?.widgets?.load;
    if (loader && wrapRef.current) {
      loader(wrapRef.current);
    }
  }, [handle, tweetId]);

  return (
    <div className="tweet-embed-wrap" ref={wrapRef}>
      <blockquote
        className="twitter-tweet"
        data-theme={theme}
        data-conversation={hideConversation ? 'none' : 'all'}
        data-dnt="true"
      >
        <a href={`https://twitter.com/${handle}/status/${tweetId}`}>
          loading post by @{handle}…
        </a>
      </blockquote>
    </div>
  );
}
