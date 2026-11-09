
from .evaluation import get_evaluation
import chess
import chess.polyglot
import math

# ============================================================
# CONFIGURATION
# ============================================================

transposition_table = {}

EXACT = 0
LOWERBOUND = 1
UPPERBOUND = 2

MATE_SCORE = 100000
MAX_TT_SIZE = 300000
MAX_QUIESCENCE_DEPTH = 8

killer_moves = {}
history_table = {}

search_generation = 0

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
    chess.KING: 20000
}


# ============================================================
# POSITION HASHING
# ============================================================

def get_hash(board):
    return (
        chess.polyglot.zobrist_hash(board),
        board.halfmove_clock
    )


# ============================================================
# MOVE ORDERING
# ============================================================

def order_moves(board, tt_move=None, ply=0):

    moves = list(board.legal_moves)
    killers = killer_moves.get(ply, [])

    scored_moves = []

    for move in moves:

        score = 0

        # 1. Transposition table move
        if move == tt_move:
            score = 10000000

        else:

            attacker = board.piece_at(move.from_square)

            # 2. Captures: MVV-LVA
            if board.is_capture(move):

                if board.is_en_passant(move):
                    victim_value = 100
                else:
                    victim = board.piece_at(move.to_square)
                    victim_value = (
                        PIECE_VALUES[victim.piece_type]
                        if victim else 0
                    )

                attacker_value = (
                    PIECE_VALUES[attacker.piece_type]
                    if attacker else 0
                )

                score += (
                    100000
                    + victim_value * 10
                    - attacker_value
                )

            # 3. Promotions
            if move.promotion:
                score += 90000 + PIECE_VALUES[move.promotion]

            # 4. Killer moves
            elif move in killers:
                score += 80000 - killers.index(move) * 100

            # 5. History heuristic
            if attacker and not board.is_capture(move):
                score += history_table.get(
                    (
                        board.turn,
                        move.from_square,
                        move.to_square
                    ),
                    0
                )

        scored_moves.append((score, move))

    scored_moves.sort(key=lambda item: item[0], reverse=True)

    return [move for _, move in scored_moves]


# ============================================================
# SEARCH HEURISTICS
# ============================================================

def update_heuristics(board, move, depth, ply):

    if board.is_capture(move) or move.promotion:
        return

    # Killer moves
    killers = killer_moves.setdefault(ply, [])

    if move not in killers:

        killers.insert(0, move)

        if len(killers) > 2:
            killers.pop()

    # History heuristic
    key = (
        board.turn,
        move.from_square,
        move.to_square
    )

    history_table[key] = min(
        history_table.get(key, 0) + depth * depth,
        100000
    )


# ============================================================
# TRANSPOSITION TABLE MANAGEMENT
# ============================================================

def store_tt(key, entry):

    old = transposition_table.get(key)

    # Keep deeper existing information
    if old and old["depth"] > entry["depth"]:
        return

    if len(transposition_table) >= MAX_TT_SIZE:

        # Evict a small batch of old entries instead
        # of clearing the entire table.
        remove_count = max(1, MAX_TT_SIZE // 10)

        for old_key in list(transposition_table)[:remove_count]:
            del transposition_table[old_key]

    transposition_table[key] = entry


# ============================================================
# QUIESCENCE SEARCH
# ============================================================

def quiescence(board, alpha, beta, maximizing_player, qdepth=0):

    if board.is_checkmate():
        return -MATE_SCORE if board.turn == chess.WHITE else MATE_SCORE

    if board.is_stalemate() or board.is_insufficient_material():
        return 0

    if board.halfmove_clock >= 100 or board.is_repetition(3):
        return 0

    in_check = board.is_check()

    # Do not evaluate a king in check
    if not in_check:

        stand_pat = get_evaluation(board)

        if qdepth >= MAX_QUIESCENCE_DEPTH:
            return stand_pat

        if maximizing_player:

            if stand_pat >= beta:
                return beta

            alpha = max(alpha, stand_pat)

        else:

            if stand_pat <= alpha:
                return alpha

            beta = min(beta, stand_pat)

    else:
        stand_pat = None

    # All evasions when in check.
    # Otherwise only captures and promotions.
    if in_check:

        moves = list(board.legal_moves)

    else:

        moves = [
            move for move in board.legal_moves
            if board.is_capture(move) or move.promotion
        ]

    # Capture ordering
    def capture_score(move):

        if move.promotion:
            return 10000 + PIECE_VALUES[move.promotion]

        if board.is_en_passant(move):
            victim_value = 100
        else:
            victim = board.piece_at(move.to_square)
            victim_value = (
                PIECE_VALUES[victim.piece_type]
                if victim else 0
            )

        attacker = board.piece_at(move.from_square)

        attacker_value = (
            PIECE_VALUES[attacker.piece_type]
            if attacker else 0
        )

        return victim_value * 10 - attacker_value

    moves.sort(key=capture_score, reverse=True)

    if not moves:
        return 0 if in_check else stand_pat

    best_score = (
        -math.inf if maximizing_player else math.inf
    )

    for move in moves:

        board.push(move)

        score = quiescence(
            board,
            alpha,
            beta,
            not maximizing_player,
            qdepth + 1
        )

        board.pop()

        if maximizing_player:

            best_score = max(best_score, score)
            alpha = max(alpha, best_score)

        else:

            best_score = min(best_score, score)
            beta = min(beta, best_score)

        if alpha >= beta:
            break

    if not in_check:

        if maximizing_player:
            return max(stand_pat, best_score)

        return min(stand_pat, best_score)

    return best_score


# ============================================================
# PRINCIPAL VARIATION SEARCH
# ============================================================

def _search(board, depth, alpha, beta, maximizing_player, ply):

    # --------------------------------------------------------
    # TERMINAL POSITIONS
    # --------------------------------------------------------

    if board.is_checkmate():
        return -MATE_SCORE if board.turn == chess.WHITE else MATE_SCORE

    if board.is_stalemate() or board.is_insufficient_material():
        return 0

    if board.halfmove_clock >= 100 or board.is_repetition(3):
        return 0

    if depth <= 0:

        return quiescence(
            board,
            alpha,
            beta,
            maximizing_player
        )

    original_alpha = alpha
    original_beta = beta

    # Repetition-sensitive positions should not reuse
    # ordinary transposition-table results.
    repetition_sensitive = board.is_repetition(2)

    key = (
        get_hash(board),
        maximizing_player
    )

    tt_move = None

    # --------------------------------------------------------
    # TRANSPOSITION TABLE LOOKUP
    # --------------------------------------------------------

    entry = None

    if not repetition_sensitive:
        entry = transposition_table.get(key)

    if entry:

        tt_move = entry["move"]

        if entry["depth"] >= depth:

            if entry["flag"] == EXACT:
                return entry["score"]

            elif entry["flag"] == LOWERBOUND:
                alpha = max(alpha, entry["score"])

            elif entry["flag"] == UPPERBOUND:
                beta = min(beta, entry["score"])

            if alpha >= beta:
                return entry["score"]

    # --------------------------------------------------------
    # MOVE ORDERING
    # --------------------------------------------------------

    moves = order_moves(
        board,
        tt_move,
        ply
    )

    best_score = (
        -math.inf if maximizing_player else math.inf
    )

    best_move = None
    first_move = True

    # --------------------------------------------------------
    # PVS SEARCH
    # --------------------------------------------------------

    for move in moves:

        board.push(move)

        if first_move:

            # First move: full-window search
            score = _search(
                board,
                depth - 1,
                alpha,
                beta,
                not maximizing_player,
                ply + 1
            )

            first_move = False

        else:

            # Remaining moves: narrow-window search
            if maximizing_player:

                score = _search(
                    board,
                    depth - 1,
                    alpha,
                    min(alpha + 1, beta),
                    False,
                    ply + 1
                )

                # Full re-search if it could improve
                # the current best result.
                if alpha < score < beta:

                    score = _search(
                        board,
                        depth - 1,
                        alpha,
                        beta,
                        False,
                        ply + 1
                    )

            else:

                score = _search(
                    board,
                    depth - 1,
                    max(beta - 1, alpha),
                    beta,
                    True,
                    ply + 1
                )

                if alpha < score < beta:

                    score = _search(
                        board,
                        depth - 1,
                        alpha,
                        beta,
                        True,
                        ply + 1
                    )

        board.pop()

        # ----------------------------------------------------
        # UPDATE BEST MOVE
        # ----------------------------------------------------

        if maximizing_player:

            if score > best_score:
                best_score = score
                best_move = move

            alpha = max(alpha, best_score)

        else:

            if score < best_score:
                best_score = score
                best_move = move

            beta = min(beta, best_score)

        # ----------------------------------------------------
        # ALPHA-BETA CUTOFF
        # ----------------------------------------------------

        if alpha >= beta:

            update_heuristics(
                board,
                move,
                depth,
                ply
            )

            break

    # --------------------------------------------------------
    # STORE TRANSPOSITION TABLE RESULT
    # --------------------------------------------------------

    if best_score <= original_alpha:
        flag = UPPERBOUND

    elif best_score >= original_beta:
        flag = LOWERBOUND

    else:
        flag = EXACT

    if not repetition_sensitive:

        store_tt(
            key,
            {
                "depth": depth,
                "score": best_score,
                "flag": flag,
                "move": best_move,
                "generation": search_generation
            }
        )

    return best_score


# ============================================================
# PUBLIC MINIMAX INTERFACE
# ============================================================

def minimax(board, depth, alpha, beta, maximizing_player):

    global search_generation

    search_generation += 1

    return _search(
        board,
        depth,
        alpha,
        beta,
        maximizing_player,
        0
    )
