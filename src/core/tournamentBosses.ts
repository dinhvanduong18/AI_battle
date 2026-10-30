export interface RankBossInfo {
  level: number;
  name: string;
  difficulty: 'medium' | 'hard' | 'very_hard' | 'extreme';
  difficultyLabel: string;
  description: string;
  avatarId: string;
  starsRequired: number;
  promoteTo: string;
}

export const RANK_BOSS_CONFIG: Record<string, RankBossInfo> = {
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

