// Route listing photos and verdict audio through /api so they load on EVERY
// subdomain. The apex (kickoff.bot) serves /uploads and /audio off disk, but the
// arena/studio vhosts only proxy /api + /ws — so a bare /uploads path returns the
// SPA's index.html there (broken image). /api/* is proxied to the backend
// everywhere, and the backend also exposes the same files under /api/uploads and
// /api/audio, so this rewrite makes them universal.
export function assetUrl(path) {
  if (!path || /^https?:\/\//i.test(path) || /^data:/i.test(path)) return path;
  const p = path.startsWith('/') ? path : `/${path}`; // "audio/x.mp3" -> "/audio/x.mp3"
  if (p.startsWith('/uploads/') || p.startsWith('/audio/')) return `/api${p}`;
  return path;
}
