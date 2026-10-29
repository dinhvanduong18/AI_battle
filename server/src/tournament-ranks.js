export const TOURNAMENT_RANKS = ['Bronze', 'Silver', 'Gold', 'Master', 'Challenger'];

export const RANK_LABELS = {
  Bronze: 'Đồng',
  Silver: 'Bạc',
  Gold: 'Vàng',
  Master: 'Cao Thủ',
  Challenger: 'Thách Đấu'
};

export const RANK_PROMOTION_STARS = {
  Bronze: 10,
  Silver: 20,
  Gold: 30,
  Master: 40,
  Challenger: 0
};

export const TIER_BASE_STARS = {
  Bronze: 0,
  Silver: 10,
  Gold: 30,
  Master: 60,
  Challenger: 100
};

export const RANK_BOSS_CONFIG = {
  Bronze: {
    level: 1,
    name: 'Thủ Hộ Kỵ Sĩ (Bậc Đồng)',
    difficulty: 'medium',
    difficultyLabel: 'Vừa',
    description: 'Chiến binh canh gác cổng Bạc. Chiến thuật linh hoạt, ưu tiên phản công và tiến nhanh về đền thờ đối phương.',
    avatarId: 'knight',
    starsRequired: 10,
    promoteTo: 'Silver',
  },
  Silver: {
    level: 2,
    name: 'Ảo Ảnh Kỵ Sĩ (Bậc Bạc)',
    difficulty: 'hard',
    difficultyLabel: 'Khá',
    description: 'Thủ lĩnh bóng đêm. Tính toán 2 nước cờ, né bẫy khắc hệ và bảo vệ chặt chẽ các quân then chốt.',
    avatarId: 'ghost',
    starsRequired: 20,
    promoteTo: 'Gold',
  },
  Gold: {
    level: 3,
    name: 'Chiến Tướng Hoàng Kim (Bậc Vàng)',
    difficulty: 'very_hard',
    difficultyLabel: 'Rất Khó',
    description: 'Bậc thầy Minimax chiến thuật. Kiểm soát khu trung tâm, ép góc và truy kích triệt để hệ quân mỏng nhất.',
    avatarId: 'pumpkin',
    starsRequired: 30,
    promoteTo: 'Master',
  },
  Master: {
    level: 4,
    name: 'Bá Vương Hắc Ám (Bậc Cao Thủ)',
    difficulty: 'extreme',
    difficultyLabel: 'Siêu Cao',
    description: 'Boss tối thượng của Đấu Trường. Trí tuệ AI đỉnh cao, tìm đường chiến thắng tuyệt đối và tận diệt mọi sơ hở.',
    avatarId: 'dragon',
    starsRequired: 40,
    promoteTo: 'Challenger',
  },
};

/**
 * applyBossResult:
 * - Thắng (score = 1): PASS -> thăng hạng lên bậc tiếp theo, sao reset về 0
 * - Thua / Hòa (score = 0 hoặc 0.5): K-PASS -> giảm 2/3 số sao hiện tại (ví dụ 30 sao -> 20 sao)
 */
export function applyBossResult(tier, currentStars, score) {
  const rankIndex = TOURNAMENT_RANKS.indexOf(tier);
  if (rankIndex < 0 || tier === 'Challenger') {
    throw new Error('Hạng không hợp lệ để khiêu chiến Boss: ' + tier);
  }
  const maxStars = RANK_PROMOTION_STARS[tier];
  const safeCurrentStars = Math.max(0, Math.min(maxStars, Math.floor(Number(currentStars) || 0)));

  if (score === 1) {
    const nextTier = TOURNAMENT_RANKS[rankIndex + 1];
    return {
      tier: nextTier,
      stars: 0,
      seasonPoints: 0,
      passed: true,
      promotedTo: nextTier,
      message: 'Xuất sắc vượt qua Boss thăng hạng! Bạn đã chính thức bước lên bậc ' + RANK_LABELS[nextTier] + '!'
    };
  }

  // K-PASS: Giảm 2/3 số sao hiện tại (ví dụ 30 * 2 / 3 = 20)
  const remainingStars = Math.floor((safeCurrentStars * 2) / 3);
  return {
    tier,
    stars: remainingStars,
    seasonPoints: 0,
    passed: false,
    promotedTo: null,
    message: 'Khiêu chiến thất bại! Bạn bị trừ 2/3 số sao hiện tại (còn ' + remainingStars + ' sao). Hãy tiếp tục rèn luyện để thách đấu lại!'
  };
}

/**
 * applyRankedMatchResult:
 * Luật leo rank giải đấu có chốt chặn Boss:
 * - Khi thắng trong rank: tăng +1 sao, CAPPED tại RANK_PROMOTION_STARS[tier].
 * - Khi đạt đủ số sao yêu cầu (ví dụ 30 sao ở Gold): KHÔNG tự động lên hạng mà chuyển sang trạng thái canChallengeBoss = true!
 */
export function applyRankedMatchResult(tier, stars, seasonPoints, score) {
  const rankIndex = TOURNAMENT_RANKS.indexOf(tier);
  if (rankIndex < 0) throw new Error('Unknown tournament rank: ' + tier);
  if (![0, 0.5, 1].includes(score)) throw new RangeError('Invalid tournament score: ' + score);

  if (tier === 'Challenger') {
    const delta = score === 1 ? 1 : score === 0 ? -1 : 0;
    const newPoints = Math.max(0, (Number(seasonPoints) || 0) + delta);
    return { tier: 'Challenger', stars: 0, seasonPoints: newPoints, canChallengeBoss: false };
  }

  const maxStars = RANK_PROMOTION_STARS[tier];
  let curStars = Math.max(0, Math.min(maxStars, Math.floor(Number(stars) || 0)));

  if (score === 1) {
    curStars = Math.min(maxStars, curStars + 1);
  } else if (score === 0) {
    if (curStars > 0) {
      curStars -= 1;
    } else if (rankIndex > 0) {
      const prevTier = TOURNAMENT_RANKS[rankIndex - 1];
      return {
        tier: prevTier,
        stars: Math.max(0, RANK_PROMOTION_STARS[prevTier] - 1),
        seasonPoints: 0,
        canChallengeBoss: false
      };
    }
  }

  return {
    tier,
    stars: curStars,
    seasonPoints: 0,
    canChallengeBoss: curStars >= maxStars
  };
}


export function rankTier(elo) {
  if (elo >= 1600) return 'Gold';
  if (elo >= 1350) return 'Silver';
  return 'Bronze';
}

export function toCumulativeScore(tier, stars = 0, seasonPoints = 0) {
  const rankIndex = TOURNAMENT_RANKS.indexOf(tier);
  if (rankIndex < 0) throw new Error(`Unknown tournament rank: ${tier}`);
  const safeStars = Math.max(0, Math.floor(Number(stars) || 0));
  const safePoints = Math.max(0, Math.floor(Number(seasonPoints) || 0));
  if (tier === 'Challenger') {
    return TIER_BASE_STARS.Challenger + safePoints;
  }
  const cappedStars = Math.min(RANK_PROMOTION_STARS[tier], safeStars);
  return TIER_BASE_STARS[tier] + cappedStars;
}

export function fromCumulativeScore(totalScore) {
  const total = Math.max(0, Math.floor(Number(totalScore) || 0));
  if (total < 10) return { tier: 'Bronze', stars: total, seasonPoints: 0 };
  if (total < 30) return { tier: 'Silver', stars: total - 10, seasonPoints: 0 };
  if (total < 60) return { tier: 'Gold', stars: total - 30, seasonPoints: 0 };
  if (total < 100) return { tier: 'Master', stars: total - 60, seasonPoints: 0 };
  return { tier: 'Challenger', stars: 0, seasonPoints: total - 100 };
}

/**
 * Per-match tournament star rule:
 * - Win (score = 1): +1 star (or +1 Challenger season point)
 * - Draw (score = 0.5): 0 change
 * - Loss (score = 0): -1 star (demotes cleanly across tier boundaries; floored at Bronze 0)
 */
export function applyTournamentResult(tier, stars, seasonPoints, score) {
  const rankIndex = TOURNAMENT_RANKS.indexOf(tier);
  if (rankIndex < 0) throw new Error(`Unknown tournament rank: ${tier}`);
  if (!Number.isInteger(stars) || stars < 0 || (tier !== 'Challenger' && stars > RANK_PROMOTION_STARS[tier])) {
    throw new RangeError(`Invalid star progress for rank ${tier}: ${stars}`);
  }
  if (![0, 0.5, 1].includes(score)) throw new RangeError(`Invalid tournament score: ${score}`);

  const currentTotal = toCumulativeScore(tier, stars, seasonPoints);
  const delta = score === 1 ? 1 : score === 0 ? -1 : 0;
  return fromCumulativeScore(Math.max(0, currentTotal + delta));
}

/**
 * Weekly Sprint rank reset formula:
 * hạng mới = x - x * (x / (x + k))
 * trong đó:
 * - x là điểm tích lũy hiện tại của người được xét (bậc + sao + điểm mùa Thách Đấu)
 * - k là điểm của người có điểm cao nhất nhân đôi (k = 2 * x_max)
 *
 * @param {string} tier
 * @param {number} [stars=0]
 * @param {number} [seasonPoints=0]
 * @param {number | null} [maxTotalScore=null]
 */
export function applySprintRankReset(tier, stars = 0, seasonPoints = 0, maxTotalScore = null) {
  const previousTotal = toCumulativeScore(tier, stars, seasonPoints);
  const effectiveMax = maxTotalScore != null
    ? Math.max(previousTotal, Math.max(0, Math.floor(Number(maxTotalScore) || 0)))
    : previousTotal;
  const k = 2 * effectiveMax;
  let resetTotal = 0;
  if (previousTotal > 0 && (previousTotal + k) > 0) {
    resetTotal = Math.floor(previousTotal - previousTotal * (previousTotal / (previousTotal + k)));
  }
  return {
    ...fromCumulativeScore(resetTotal),
    previousTotal,
    resetTotal,
    k,
    maxTotalScore: effectiveMax
  };
}

/**
 * Builds private motivational / competitive messaging without leaking Challenger standings.
 * @param {any} entry
 * @param {number | null} [challengerRank=null]
 * @param {number | null} [maxTotalScore=null]
 */
export function buildTournamentMotivation(entry, challengerRank = null, maxTotalScore = null) {
  if (!entry) {
    return {
      tier: null,
      bracket: 'unregistered',
      groupLabel: 'Chưa ghi danh · Cánh cửa giải đấu đang mở',
      tone: 'motivational',
      quote: 'Ghi danh giải đấu để bắt đầu hành trình leo Sao. Bạn có thể lưu Bot Python trong Phòng Lab sau khi tham gia, trước khi tìm trận.'
    };
  }

  const tier = entry.tier || 'Bronze';
  const stars = Number(entry.stars ?? entry.rank_stars ?? 0);
  const seasonPoints = Number(entry.seasonPoints ?? entry.season_points ?? 0);
  const currentTotal = toCumulativeScore(tier, stars, seasonPoints);
  const resetResult = applySprintRankReset(tier, stars, seasonPoints, maxTotalScore);
  const nextSprintTotal = resetResult.resetTotal;
  const nextSprintPreview = resetResult;

  if (tier === 'Bronze') {
    return {
      tier,
      bracket: 'bronze',
      groupLabel: 'Bậc Đồng · Khởi đầu hành trình (Mốc 10 Sao)',
      tone: 'motivational',
      currentTotal,
      nextSprintTotal,
      nextSprintTier: nextSprintPreview.tier,
      nextSprintStars: nextSprintPreview.stars,
      nextSprintPoints: nextSprintPreview.seasonPoints,
      quote: 'Mọi huyền thoại đều bắt đầu từ những nước cờ đầu tiên. Đừng ngại thử sai — hãy tinh chỉnh từng dòng code Python và tích lũy đủ 10 Sao đầu tiên để bứt phá khỏi bậc Đồng!'
    };
  }

  if (tier === 'Silver') {
    return {
      tier,
      bracket: 'silver',
      groupLabel: 'Bậc Bạc · Rèn giũa bản lĩnh (Mốc 20 Sao)',
      tone: 'motivational',
      currentTotal,
      nextSprintTotal,
      nextSprintTier: nextSprintPreview.tier,
      nextSprintStars: nextSprintPreview.stars,
      nextSprintPoints: nextSprintPreview.seasonPoints,
      quote: 'Bot của bạn đã biết cách đọc thế trận, nhưng sự ổn định mới tạo nên khác biệt. Kiên trì tối ưu thuật toán khắc hệ qua từng ván để chinh phục 20 Sao tiến lên bậc Vàng!'
    };
  }

  if (tier === 'Gold') {
    return {
      tier,
      bracket: 'gold',
      groupLabel: 'Bậc Vàng · Khẳng định thực lực (Mốc 30 Sao)',
      tone: 'motivational',
      currentTotal,
      nextSprintTotal,
      nextSprintTier: nextSprintPreview.tier,
      nextSprintStars: nextSprintPreview.stars,
      nextSprintPoints: nextSprintPreview.seasonPoints,
      quote: 'Nửa chặng đường chinh phục đỉnh cao đã ở phía sau. Ở bậc Vàng, đối thủ không còn mắc lỗi sơ đẳng — hãy nâng tầm chiến thuật kiểm soát trung tâm để giành trọn 30 Sao bước vào hàng ngũ Cao Thủ!'
    };
  }

  if (tier === 'Master') {
    return {
      tier,
      bracket: 'master',
      groupLabel: 'Bậc Cao Thủ · Ngưỡng cửa Thách Đấu (Mốc 40 Sao)',
      tone: 'competitive-climb',
      currentTotal,
      nextSprintTotal,
      nextSprintTier: nextSprintPreview.tier,
      nextSprintStars: nextSprintPreview.stars,
      nextSprintPoints: nextSprintPreview.seasonPoints,
      quote: 'Chỉ còn một bước nữa thôi là chạm tới đấu trường danh giá nhất! Bản lĩnh Cao Thủ nằm ở sự sắc lạnh trước áp lực — bứt tốc vượt mốc 40 Sao để ghi tên mình vào Thách Đấu!'
    };
  }

  // Challenger brackets (Rank 1..7 = top_7, 8..12 = outside_top_7, 13..20 = outside_top_12, 21+ = outside_top_20 / top_30)
  const r = Number(challengerRank) || 999;
  if (r <= 7) {
    return {
      tier: 'Challenger',
      bracket: 'top_7',
      groupLabel: 'Thách Đấu · Nhóm Dẫn Đầu (Top 7)',
      tone: 'ego-dominance',
      currentTotal,
      nextSprintTotal,
      nextSprintTier: nextSprintPreview.tier,
      nextSprintStars: nextSprintPreview.stars,
      nextSprintPoints: nextSprintPreview.seasonPoints,
      quote: 'Bạn đang ngự trị trên đỉnh cao nhất nơi mọi kỳ thủ Thách Đấu đều rình rập lật đổ! Đừng để sự tự mãn đánh cắp vị thế độc tôn — hãy nghiền nát mọi kẻ thách thức để bảo toàn ngôi vương khi bảng xếp hạng công bố!'
    };
  }
  if (r <= 12) {
    return {
      tier: 'Challenger',
      bracket: 'outside_top_7',
      groupLabel: 'Thách Đấu · Ngoài Top 7',
      tone: 'ego-fierce',
      currentTotal,
      nextSprintTotal,
      nextSprintTier: nextSprintPreview.tier,
      nextSprintStars: nextSprintPreview.stars,
      nextSprintPoints: nextSprintPreview.seasonPoints,
      quote: 'Ngai vàng đã ở ngay trước mắt mà bạn vẫn chấp nhận đứng ngoài Top 7 sao? Ở đẳng cấp này, một thuật toán an toàn là chưa đủ — chỉ kẻ khao khát chiến thắng mãnh liệt nhất mới xứng đáng chen chân vào nhóm dẫn đầu!'
    };
  }
  if (r <= 20) {
    return {
      tier: 'Challenger',
      bracket: 'outside_top_12',
      groupLabel: 'Thách Đấu · Ngoài Top 12',
      tone: 'competitive',
      currentTotal,
      nextSprintTotal,
      nextSprintTier: nextSprintPreview.tier,
      nextSprintStars: nextSprintPreview.stars,
      nextSprintPoints: nextSprintPreview.seasonPoints,
      quote: 'Khoảng cách tới nhóm tinh anh đang thu hẹp từng điểm một, nhưng những cái tên phía trên chưa bao giờ ngừng thắng. Đừng bằng lòng với vị trí lưng chừng — hãy chứng minh Bot của bạn đủ bản lĩnh phá vỡ rào cản Top 12!'
    };
  }
  return {
    tier: 'Challenger',
    bracket: 'outside_top_20',
    groupLabel: 'Thách Đấu · Nhóm Top 30 (Ngoài Top 20)',
    tone: 'competitive-drive',
    currentTotal,
    nextSprintTotal,
    nextSprintTier: nextSprintPreview.tier,
    nextSprintStars: nextSprintPreview.stars,
    nextSprintPoints: nextSprintPreview.seasonPoints,
    quote: 'Đặt chân vào Thách Đấu mới chỉ là tấm vé nhập cuộc. Ở nhóm ngoài Top 20, dậm chân tại chỗ đồng nghĩa với bị bỏ lại phía sau — hãy nâng cấp chiến thuật ngay và giành lấy những chiến thắng đầu tiên để bứt lên!'
  };
}

export function tournamentRanks() {
  return TOURNAMENT_RANKS.map((tier, index) => ({
    tier,
    label: RANK_LABELS[tier],
    index,
    starsToPromote: RANK_PROMOTION_STARS[tier],
    boss: RANK_BOSS_CONFIG[tier] || null
  }));
}
