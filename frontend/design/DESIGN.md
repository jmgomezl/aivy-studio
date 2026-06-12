# Kickoff / Aivy design system

Canonical reference: `reference.html` (approved draft). All three surfaces share
the same tokens; each has its own purpose and layout density.

## Surfaces
| Surface | Domain | Purpose | Key views |
|---|---|---|---|
| Telegram Mini App | t.me bot webview | Judge/buyer makes offers | Offer (amount + argument), result state |
| Website | kickoff.bot | Marketing + live arena | Hero w/ live card, agents grid, deals table, Arena (projector) |
| Studio | studio.aivylabs.xyz | Canvas orchestration | @xyflow/react graph, template library, Kickoff template |

## Tokens
--bg #08080D · --surface #0F0F18 · --card #13131E · --border #1C1C2E
--accent #00FF87 (seller/success) · --blue #4488FF (human buyer) · --purple/#A78BFA (buyer agent)
--yellow #FFB800 (negotiating) · --red #FF4444 (reject) · --text #EEEEF5 · --muted #55556A
Fonts: Space Grotesk (sans/UI), Space Mono (mono/data, hashes, prices, labels)

## Component language
- Ticker bar (accent bg, black mono text) for deal flow
- Live dot pulse for anything on-chain/live
- Chat bubbles: seller left (card bg), human right (blue tint), buyer-agent right (purple tint)
- System messages: yellow-tinted mono bubbles = on-chain receipts (HCS-10 seq, tx hash)
- Sell-probability meter: green>65, yellow>35, red below — drives the drama
- Reveal grid: 3 cells (min on-chain / accepted / spread) — the climactic moment
- Role colors are SEMANTIC, keep them consistent across all surfaces

## Rules
- Spanish default, EN toggle (i18next)
- Mini App index.html served with Cache-Control: no-store (Telegram webview caches hard)
- Real data replaces the simulated feed: WebSocket events from backend (mirror-node sourced)

## Theming
- kickoff.bot + Studio: DARK ONLY (identity + projector legibility)
- Mini App: follows Telegram themeParams — `data-theme="light"` on <html> swaps tokens
  (via @twa-dev/sdk: WebApp.colorScheme, listen to themeChanged event)
- Light accent is darkened (#00A857) for contrast on white; role semantics unchanged
