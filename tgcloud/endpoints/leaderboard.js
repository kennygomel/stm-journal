// endpoints/leaderboard.js — недельный рейтинг: текущая неделя и итоги прошлой.
//
// Доступен всем одобренным пользователям: это соревнование, а не админка.
// Итоги прошлой недели считаются лениво при первом запросе после полуночи
// понедельника (см. lib/leaderboard.js).

import { requireUser } from '../lib/auth.js';
import { leaderboardData } from '../lib/leaderboard.js';

export default async function (input, ctx) {
  const user = await requireUser(ctx);
  return leaderboardData(user.id);
}
