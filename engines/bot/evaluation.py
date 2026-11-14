
import chess

from .material import get_material
from . import positions


# ============================================================
# CONFIGURATION
# All values are in centipawns.
# Positive scores favour White.
# ============================================================

CHECKMATE = 99999

# Pawn structure
DOUBLED_PAWN_PENALTY = 13
ISOLATED_PAWN_PENALTY = 15
BACKWARD_PAWN_PENALTY = 10
CONNECTED_PAWN_BONUS = 5

PASSED_PAWN_BONUS = [0, 5, 12, 22, 40, 65, 105, 0]

# Piece activity
MOBILITY_BONUS = {
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 2,
    chess.QUEEN: 1,
}

ROOK_OPEN_FILE_BONUS = 20
ROOK_SEMI_OPEN_FILE_BONUS = 10
ROOK_SEVENTH_RANK_BONUS = 20
ROOK_BEHIND_PASSED_PAWN_BONUS = 12

# King safety
KING_SHIELD_BONUS = 10
KING_OPEN_FILE_PENALTY = 12
KING_ATTACK_FILE_PENALTY = 20

# Piece safety
HANGING_PIECE_PENALTY_PERCENT = 12
MAX_HANGING_PIECE_PENALTY = 100

# Tempo
TEMPO_BONUS = 10


# ============================================================
# PIECE VALUES
# Used for positional calculations, not material evaluation.
# Material itself is calculated by your existing material.py.
# ============================================================

PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 310,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}


# ============================================================
# GAME PHASE
# 1.0 = opening / middlegame
# 0.0 = endgame
# ============================================================

def get_game_phase(board):

    phase = 0

    phase += len(board.pieces(chess.KNIGHT, chess.WHITE))
    phase += len(board.pieces(chess.KNIGHT, chess.BLACK))

    phase += len(board.pieces(chess.BISHOP, chess.WHITE))
    phase += len(board.pieces(chess.BISHOP, chess.BLACK))

    phase += 2 * len(board.pieces(chess.ROOK, chess.WHITE))
    phase += 2 * len(board.pieces(chess.ROOK, chess.BLACK))

    phase += 4 * len(board.pieces(chess.QUEEN, chess.WHITE))
    phase += 4 * len(board.pieces(chess.QUEEN, chess.BLACK))

    return min(phase / 24.0, 1.0)


# ============================================================
# KING POSITIONING
# ============================================================

def king_endgame_score(square):

    file = chess.square_file(square)
    rank = chess.square_rank(square)

    distance = abs(file - 3.5) + abs(rank - 3.5)

    return int(40 - distance * 10)


def get_piece_square_score(board, phase):

    score = 0

    piece_tables = {
        chess.PAWN: positions.pawn,
        chess.KNIGHT: positions.knight,
        chess.BISHOP: positions.bishop,
        chess.ROOK: positions.rook,
        chess.QUEEN: positions.queen,
    }

    # Non-king pieces
    for piece_type, table in piece_tables.items():

        for square in board.pieces(piece_type, chess.WHITE):
            score += table[square]

        for square in board.pieces(piece_type, chess.BLACK):
            score -= table[chess.square_mirror(square)]

    # White king
    for square in board.pieces(chess.KING, chess.WHITE):

        opening = positions.king[square]
        endgame = king_endgame_score(square)

        score += phase * opening + (1.0 - phase) * endgame

    # Black king
    for square in board.pieces(chess.KING, chess.BLACK):

        mirrored = chess.square_mirror(square)

        opening = positions.king[mirrored]
        endgame = king_endgame_score(mirrored)

        score -= phase * opening + (1.0 - phase) * endgame

    return int(score)


# ============================================================
# PAWN STRUCTURE
# ============================================================

def is_passed_pawn(board, square, color):

    file = chess.square_file(square)
    rank = chess.square_rank(square)

    enemy_pawns = board.pieces(chess.PAWN, not color)

    for enemy in enemy_pawns:

        enemy_file = chess.square_file(enemy)
        enemy_rank = chess.square_rank(enemy)

        # Enemy pawns on the same or adjacent files
        if abs(enemy_file - file) > 1:
            continue

        # Enemy pawn must be ahead
        if color == chess.WHITE and enemy_rank > rank:
            return False

        if color == chess.BLACK and enemy_rank < rank:
            return False

    return True


def is_isolated_pawn(square, friendly_pawns):

    file = chess.square_file(square)

    for pawn in friendly_pawns:

        other_file = chess.square_file(pawn)

        if abs(other_file - file) == 1:
            return False

    return True


def is_backward_pawn(board, square, color, friendly_pawns):

    file = chess.square_file(square)
    rank = chess.square_rank(square)

    # Find whether another friendly pawn can support this pawn.
    supported = False

    for pawn in friendly_pawns:

        other_file = chess.square_file(pawn)
        other_rank = chess.square_rank(pawn)

        if abs(other_file - file) != 1:
            continue

        if color == chess.WHITE and other_rank < rank:
            supported = True
            break

        if color == chess.BLACK and other_rank > rank:
            supported = True
            break

    if supported:
        return False

    # Check the square immediately in front.
    direction = 1 if color == chess.WHITE else -1

    front_rank = rank + direction

    if not 0 <= front_rank <= 7:
        return False

    front_square = chess.square(file, front_rank)

    # An occupied square means the pawn is not simply backward.
    if board.piece_at(front_square):
        return False

    # Check whether an enemy pawn controls the square ahead.
    enemy_pawns = board.pieces(chess.PAWN, not color)

    for enemy in enemy_pawns:

        if front_square in board.attacks(enemy):
            return True

    return False


def get_pawn_structure_score(board, phase):

    score = 0

    for color in (chess.WHITE, chess.BLACK):

        sign = 1 if color == chess.WHITE else -1

        friendly_pawns = list(board.pieces(chess.PAWN, color))

        pawn_files = [0] * 8

        for pawn in friendly_pawns:
            pawn_files[chess.square_file(pawn)] += 1

        # Doubled pawns
        for count in pawn_files:

            if count > 1:
                score -= sign * DOUBLED_PAWN_PENALTY * (count - 1)

        for square in friendly_pawns:

            # Isolated pawns
            if is_isolated_pawn(square, friendly_pawns):
                score -= sign * ISOLATED_PAWN_PENALTY

            # Backward pawns
            if is_backward_pawn(
                board, square, color, friendly_pawns
            ):
                score -= sign * BACKWARD_PAWN_PENALTY

            # Connected / supported pawns
            if board.attackers(color, square) & board.pieces(
                chess.PAWN, color
            ):
                score += sign * CONNECTED_PAWN_BONUS

            # Passed pawns
            if is_passed_pawn(board, square, color):

                rank = chess.square_rank(square)

                advancement = (
                    rank if color == chess.WHITE else 7 - rank
                )

                bonus = PASSED_PAWN_BONUS[advancement]

                # Passed pawns become much more dangerous in endgames.
                score += sign * bonus * (1.0 - 0.35 * phase)

    return int(score)


# ============================================================
# PIECE MOBILITY
# ============================================================

def get_mobility_score(board):

    score = 0

    for color in (chess.WHITE, chess.BLACK):

        sign = 1 if color == chess.WHITE else -1

        own_pieces = board.occupied_co[color]

        for piece_type, bonus in MOBILITY_BONUS.items():

            for square in board.pieces(piece_type, color):

                attacks = board.attacks(square)

                # Ignore squares occupied by friendly pieces.
                mobility = (attacks & ~own_pieces).bit_count()

                # Avoid excessive bonuses for queens and rooks.
                mobility = min(mobility, 15)

                score += sign * mobility * bonus

    return score


# ============================================================
# ROOK ACTIVITY
# ============================================================

def get_rook_activity_score(board):

    score = 0

    for color in (chess.WHITE, chess.BLACK):

        sign = 1 if color == chess.WHITE else -1

        friendly_pawns = board.pieces(chess.PAWN, color)
        enemy_pawns = board.pieces(chess.PAWN, not color)

        for rook in board.pieces(chess.ROOK, color):

            file = chess.square_file(rook)
            rank = chess.square_rank(rook)

            friendly_on_file = any(
                chess.square_file(p) == file
                for p in friendly_pawns
            )

            enemy_on_file = any(
                chess.square_file(p) == file
                for p in enemy_pawns
            )

            # Open and semi-open files
            if not friendly_on_file and not enemy_on_file:

                score += sign * ROOK_OPEN_FILE_BONUS

            elif not friendly_on_file:

                score += sign * ROOK_SEMI_OPEN_FILE_BONUS

            # Seventh rank
            seventh_rank = 6 if color == chess.WHITE else 1

            if rank == seventh_rank:
                score += sign * ROOK_SEVENTH_RANK_BONUS

            # Rook behind its own passed pawn
            for pawn in friendly_pawns:

                if not is_passed_pawn(board, pawn, color):
                    continue

                if chess.square_file(pawn) != file:
                    continue

                pawn_rank = chess.square_rank(pawn)

                if (
                    color == chess.WHITE and rank < pawn_rank
                ) or (
                    color == chess.BLACK and rank > pawn_rank
                ):
                    score += sign * ROOK_BEHIND_PASSED_PAWN_BONUS
                    break

    return score


# ============================================================
# KING SAFETY
# ============================================================

def get_king_safety_score(board, phase):

    # King safety is primarily important in the middlegame.
    if phase < 0.2:
        return 0

    score = 0

    for color in (chess.WHITE, chess.BLACK):

        sign = 1 if color == chess.WHITE else -1

        king_square = board.king(color)

        if king_square is None:
            continue

        king_file = chess.square_file(king_square)
        king_rank = chess.square_rank(king_square)

        friendly_pawns = board.pieces(chess.PAWN, color)
        enemy_rooks = board.pieces(chess.ROOK, not color)
        enemy_queens = board.pieces(chess.QUEEN, not color)

        # Pawn shield
        shield_count = 0

        direction = 1 if color == chess.WHITE else -1

        for file in range(
            max(0, king_file - 1),
            min(7, king_file + 1) + 1
        ):

            for distance in (1, 2):

                rank = king_rank + direction * distance

                if not 0 <= rank <= 7:
                    continue

                square = chess.square(file, rank)

                if square in friendly_pawns:
                    shield_count += 1
                    break

        score += sign * shield_count * KING_SHIELD_BONUS

        # Open files near the king
        for file in range(
            max(0, king_file - 1),
            min(7, king_file + 1) + 1
        ):

            friendly_pawn_on_file = any(
                chess.square_file(p) == file
                for p in friendly_pawns
            )

            enemy_heavy_piece_on_file = any(
                chess.square_file(p) == file
                for p in list(enemy_rooks) + list(enemy_queens)
            )

            if not friendly_pawn_on_file:

                score -= sign * KING_OPEN_FILE_PENALTY

                if enemy_heavy_piece_on_file:
                    score -= sign * KING_ATTACK_FILE_PENALTY

    return int(score * phase)


# ============================================================
# PIECE SAFETY
# ============================================================

def get_piece_safety_score(board):

    score = 0

    for color in (chess.WHITE, chess.BLACK):

        sign = 1 if color == chess.WHITE else -1

        enemy = not color

        for piece_type, value in PIECE_VALUES.items():

            for square in board.pieces(piece_type, color):

                attackers = board.attackers(enemy, square)

                if not attackers:
                    continue

                defenders = board.attackers(color, square)

                # Only penalise attacked pieces that have no defenders.
                if defenders:
                    continue

                penalty = int(
                    value * HANGING_PIECE_PENALTY_PERCENT / 100
                )

                penalty = min(
                    penalty, MAX_HANGING_PIECE_PENALTY
                )

                score -= sign * penalty

    return score


# ============================================================
# TERMINAL POSITIONS
# ============================================================

def get_terminal_score(board):

    if board.is_checkmate():

        return -CHECKMATE if board.turn == chess.WHITE else CHECKMATE

    if (
        board.is_stalemate()
        or board.is_insufficient_material()
        or board.is_seventyfive_moves()
        or board.is_fivefold_repetition()
    ):
        return 0

    return None


# ============================================================
# MAIN EVALUATION FUNCTION
# ============================================================

def get_evaluation(board):

    # Terminal positions
    terminal_score = get_terminal_score(board)

    if terminal_score is not None:
        return terminal_score

    phase = get_game_phase(board)

    # Material
    score = get_material(board)

    # Piece positioning
    score += get_piece_square_score(board, phase)

    # Positional features
    score += get_pawn_structure_score(board, phase)

    score += get_mobility_score(board)

    score += get_rook_activity_score(board)

    # King safety
    score += get_king_safety_score(board, phase)

    # Hanging pieces
    score += get_piece_safety_score(board)

    # Tempo: the side to move receives a small bonus.
    if board.turn == chess.WHITE:
        score += TEMPO_BONUS
    else:
        score -= TEMPO_BONUS

    return int(score)
