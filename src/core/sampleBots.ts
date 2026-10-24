export type SampleBotKey = 'template' | 'random' | 'greedy' | 'minimax' | 'phantom_hunter';

export const SAMPLE_BOT_LABELS: Record<SampleBotKey, { name: string; difficulty: string; summary: string }> = {
  template: {
    name: 'Mẫu Starter',
    difficulty: 'Cơ bản',
    summary: 'Khung code khởi đầu gọn nhẹ để bạn tự viết chiến thuật Python 3.',
  },
  random: {
    name: 'Random Bot',
    difficulty: 'Dễ',
    summary: 'Chọn ngẫu nhiên một nước đi hợp lệ trong danh sách validMoves.',
  },
  greedy: {
    name: 'Greedy AI',
    difficulty: 'Trung bình',
    summary: 'Ưu tiên ăn quân trực tiếp và tiến nhanh về phía ô mục tiêu chiến thắng.',
  },
  minimax: {
    name: 'Minimax Tactical',
    difficulty: 'Khá',
    summary: 'Chấm điểm vị trí trung tâm, tấn công có chọn lọc và né bẫy khắc hệ.',
  },
  phantom_hunter: {
    name: 'Phantom Hunter (Halloween)',
    difficulty: 'Nâng cao',
    summary: 'Truy sát hệ quân ít nhất của đối phương để kích hoạt điều kiện thắng diệt hệ.',
  },
};

export const SAMPLE_BOTS: Record<SampleBotKey, string> = {
  template: `def get_next_move(my_player_id, game_state):
    """Trả về 1 nước đi hợp lệ từ game_state['validMoves']."""
    valid_moves = game_state.get('validMoves', [])
    if not valid_moves:
        return None
    move = valid_moves[0]
    return {
        'fromRow': move['fromRow'],
        'fromCol': move['fromCol'],
        'toRow': move['toRow'],
        'toCol': move['toCol'],
    }`,

  random: `import random

def get_next_move(my_player_id, game_state):
    valid_moves = game_state.get('validMoves', [])
    if not valid_moves:
        return None
    move = random.choice(valid_moves)
    return {
        'fromRow': move['fromRow'],
        'fromCol': move['fromCol'],
        'toRow': move['toRow'],
        'toCol': move['toCol'],
    }`,

  greedy: `def get_next_move(my_player_id, game_state):
    valid_moves = game_state.get('validMoves', [])
    if not valid_moves:
        return None
    # P1 mục tiêu là góc trên phải i9 (0, 8); P2 mục tiêu là góc dưới trái a1 (8, 0)
    goal_row, goal_col = (0, 8) if my_player_id == 1 else (8, 0)
    best_move = valid_moves[0]
    best_score = float('-inf')

    for move in valid_moves:
        score = 120 if move.get('isAttack') else 0
        old_dist = abs(move['fromRow'] - goal_row) + abs(move['fromCol'] - goal_col)
        new_dist = abs(move['toRow'] - goal_row) + abs(move['toCol'] - goal_col)
        score += (old_dist - new_dist) * 22
        center_dist = abs(move['toRow'] - 4) + abs(move['toCol'] - 4)
        score += (8 - center_dist) * 3
        if move['toRow'] == goal_row and move['toCol'] == goal_col:
            score += 9999
        if score > best_score:
            best_score = score
            best_move = move

    return {
        'fromRow': best_move['fromRow'],
        'fromCol': best_move['fromCol'],
        'toRow': best_move['toRow'],
        'toCol': best_move['toCol'],
    }`,

  minimax: `def get_next_move(my_player_id, game_state):
    """Đánh giá chiến thuật: ưu tiên chiếm căn cứ đối thủ, ăn quân an toàn và kiểm soát trung tâm."""
    valid_moves = game_state.get('validMoves', [])
    if not valid_moves:
        return None

    # P1 mục tiêu là i9 (0, 8); P2 mục tiêu là a1 (8, 0)
    goal_row, goal_col = (0, 8) if my_player_id == 1 else (8, 0)
    opponents = game_state.get('opponentPieces', [])
    counters = {'rock': 'paper', 'paper': 'scissors', 'scissors': 'rock'}

    best_move = valid_moves[0]
    best_score = float('-inf')

    for move in valid_moves:
        if move['toRow'] == goal_row and move['toCol'] == goal_col:
            return {
                'fromRow': move['fromRow'],
                'fromCol': move['fromCol'],
                'toRow': move['toRow'],
                'toCol': move['toCol'],
            }

        score = 160 if move.get('isAttack') else 0
        distance = abs(move['toRow'] - goal_row) + abs(move['toCol'] - goal_col)
        score -= distance * 12
        score -= (abs(move['toRow'] - 4) + abs(move['toCol'] - 4)) * 2

        my_type = move.get('pieceType')
        threat_type = counters.get(my_type)
        for opp in opponents:
            chebyshev = max(abs(opp['row'] - move['toRow']), abs(opp['col'] - move['toCol']))
            if chebyshev == 1 and opp.get('type') == threat_type:
                score -= 95

        if score > best_score:
            best_score = score
            best_move = move

    return {
        'fromRow': best_move['fromRow'],
        'fromCol': best_move['fromCol'],
        'toRow': best_move['toRow'],
        'toCol': best_move['toCol'],
    }`,

  phantom_hunter: `def get_next_move(my_player_id, game_state):
    """Phantom Hunter: Săn đuổi hệ quân ít nhất của đối phương hoặc đánh chiếm căn cứ địch."""
    valid_moves = game_state.get('validMoves', [])
    if not valid_moves:
        return None

    target_win_index = 8 if my_player_id == 1 else 72
    opp_counts = game_state.get('opponentPieceCounts', {'rock': 3, 'paper': 3, 'scissors': 3})
    opponents = game_state.get('opponentPieces', [])
    beats = {'rock': 'scissors', 'scissors': 'paper', 'paper': 'rock'}
    beaten_by = {'rock': 'paper', 'paper': 'scissors', 'scissors': 'rock'}

    # Xác định hệ quân ít nhất còn sót lại của đối phương
    weakest_type = min(['rock', 'paper', 'scissors'], key=lambda t: opp_counts.get(t, 99))

    best_move = valid_moves[0]
    best_score = float('-inf')

    for move in valid_moves:
        if move.get('to') == target_win_index:
            return {
                'fromRow': move['fromRow'],
                'fromCol': move['fromCol'],
                'toRow': move['toRow'],
                'toCol': move['toCol'],
            }

        score = 0
        my_type = move.get('pieceType')
        prey_type = beats.get(my_type)

        if move.get('isAttack'):
            target_t = move.get('targetType')
            remaining = opp_counts.get(target_t, 3)
            if remaining <= 1:
                return {
                    'fromRow': move['fromRow'],
                    'fromCol': move['fromCol'],
                    'toRow': move['toRow'],
                    'toCol': move['toCol'],
                }
            score += 240 if target_t == weakest_type else 150

        # Áp sát con mồi khắc hệ
        for opp in opponents:
            dist = max(abs(opp['row'] - move['toRow']), abs(opp['col'] - move['toCol']))
            if opp.get('type') == prey_type:
                bonus = 18 if prey_type == weakest_type else 10
                score += max(0, 9 - dist) * bonus
            elif opp.get('type') == beaten_by.get(my_type) and dist == 1:
                score -= 120

        if score > best_score:
            best_score = score
            best_move = move

    return {
        'fromRow': best_move['fromRow'],
        'fromCol': best_move['fromCol'],
        'toRow': best_move['toRow'],
        'toCol': best_move['toCol'],
    }`,
};
