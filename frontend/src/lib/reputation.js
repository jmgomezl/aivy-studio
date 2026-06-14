// Reputation tiers (eBay / MercadoLibre style). Derived from real completed-deal
// counts on the backend; here we just map a tier to a label + colour + icon.
export const TIERS = {
  new: { label: 'New', color: 'var(--muted)', icon: '🔰' },
  bronze: { label: 'Bronze', color: '#CD7F32', icon: '🥉' },
  silver: { label: 'Silver', color: '#9FB0C3', icon: '🥈' },
  gold: { label: 'Top seller', color: 'var(--yellow)', icon: '⭐' },
};

export function tierOf(rep) {
  return TIERS[rep?.tier] || TIERS.new;
}
