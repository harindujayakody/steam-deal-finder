// Help page. Mostly static content — just icon injection.

import { iconSvg } from '../theme/icons.js';

function setIcon(id, name, size) {
  const el = document.getElementById(id);
  if (!el) return;
  try { el.innerHTML = iconSvg(name, { size }); } catch { /* cosmetic only */ }
}

setIcon('icKey', 'key', 13);
setIcon('icPlay', 'circle_play', 13);
setIcon('icInfo', 'circle_info', 13);
setIcon('creditHeart', 'heart', 11);
