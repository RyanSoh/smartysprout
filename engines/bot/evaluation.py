
import chess
from .material import get_material
from . import positions


# Evaluation values are in centipawns.
CHECKMATE = 99999

BISHOP_PAIR_BONUS = 30

DOUBLED_PAWN_PENALTY = 15
ISOLATED_PAWN_PENALTY = 15
PASSED_PAWN_BONUS = [0, 5, 10, 20, 35, 60, 100, 0]

ROOK_OPEN_FILE_BONUS = 20
ROOK_SEMI_OPEN_FILE_BONUS = 10

KING_ENDGAME_SCALE = 1.0


def get_game_phase(board):
    """
    Returns a value between 0 (endgame) and 1 (opening).
    Based on the remaining non-pawn material.
    """

    phase = 0

    phase += len(board.pieces(chess.KNIGHT, chess.WHITE)) * 1
    phase += len(board.pieces(chess.KNIGHT, chess.BLACK)) * 1
    phase += len(board.pieces(chess.BISHOP, chess.WHITE)) * 1
    phase += len(board.pieces(chess.BISHOP, chess.BLACK)) * 1
    phase += len(board.pieces(chess.ROOK, chess.WHITE)) * 2
    phase += len(board.pieces(chess.ROOK, chess.BLACK)) * 2
    phase += len(board.pieces(chess.QUEEN, chess.WHITE)) * 4
    phase += len(board.pieces(chess.QUEEN, chess.BLACK)) * 4

    return min(phase / 24, 1.0)


def get_piece_square_score(board, phase):
    """
    Evaluates piece positioning using the existing piece-square tables.
    Blends king positioning between opening and endgame.
    """

    score = 0

    piece_tables = {
        chess.PAWN: positions.pawn,
        chess.KNIGHT: positions.knight,
        chess.BISHOP: positions.bishop,
        chess.ROOK: positions.rook,
        chess.QUEEN: positions.queen,
    }

    for piece_type, table in piece_tables.items():

        for square in board.pieces(piece_type, chess.WHITE):
            score += table[square]

        for square in board.pieces(piece_type, chess.BLACK):
            score -= table[chess.square_mirror(square)]

    # King positioning:
    # Your existing king table favours safe, sheltered kings.
    # In the endgame, the king should instead move towards the centre.
    for square in board.pieces(chess.KING, chess.WHITE):
        opening_score = positions.king[square]
        endgame_score = king_endgame_score(square)
        score += phase * opening_score + (1 - phase) * endgame_score

    for square in board.pieces(chess.KING, chess.BLACK):
        mirrored = chess.square_mirror(square)
        opening_score = positions.king[mirrored]
        endgame_score = king_endgame_score(mirrored)
        score -= phase * opening_score + (1 - phase) * endgame_score

    return score


def king_endgame_score(square):
    """
    Rewards kings for occupying central squares in the endgame.
    """

    file = chess.square_file(square)
    rank = chess.square_rank(square)

    distance_from_centre = (
        abs(file - 3.5) + abs(rank - 3.5)
    )

    return int(40 - distance_from_centre * 10)


def get_bishop_pair_score(board):
    score = 0

    if len(board.pieces(chess.BISHOP, chess.WHITE)) >= 2:
        score += BISHOP_PAIR_BONUS

    if len(board.pieces(chess.BISHOP, chess.BLACK)) >= 2:
        score -= BISHOP_PAIR_BONUS

    return score


def get_pawn_structure_score(board):
    score = 0

    for color in [chess.WHITE, chess.BLACK]:

        sign = 1 if color == chess.WHITE else -1
        pawns = list(board.pieces(chess.PAWN, color))
        enemy_pawns = list(board.pieces(chess.PAWN, not color))

        pawn_files = {}

        for square in pawns:
            file = chess.square_file(square)
            pawn_files[file] = pawn_files.get(file, 0) + 1

        # Doubled pawns
        for count in pawn_files.values():
            if count > 1:
                score -= sign * DOUBLED_PAWN_PENALTY * (count - 1)

        for square in pawns:

            file = chess.square_file(square)
            rank = chess.square_rank(square)

            # Isolated pawns: no friendly pawns on adjacent files.
            adjacent_files = [f for f in [file - 1, file + 1]
                              if 0 <= f <= 7]

            if not any(
                chess.square_file(p) in adjacent_files
                for p in pawns
            ):
                score -= sign * ISOLATED_PAWN_PENALTY

            # Passed pawns: no enemy pawn can stop or capture them.
            passed = True

            for enemy_square in enemy_pawns:

                enemy_file = chess.square_file(enemy_square)
                enemy_rank = chess.square_rank(enemy_square)

                if abs(enemy_file - file) <= 1:

                    if color == chess.WHITE and enemy_rank > rank:
                        passed = False
                        break

                    if color == chess.BLACK and enemy_rank < rank:
                        passed = False
                        break

            if passed:
                advancement = rank if color == chess.WHITE else 7 - rank
                score += sign * PASSED_PAWN_BONUS[advancement]

    return score


def get_rook_activity_score(board):
    score = 0

    for color in [chess.WHITE, chess.BLACK]:

        sign = 1 if color == chess.WHITE else -1
        friendly_pawns = list(board.pieces(chess.PAWN, color))
        enemy_pawns = list(board.pieces(chess.PAWN, not color))

        for rook in board.pieces(chess.ROOK, color):

            file = chess.square_file(rook)

            friendly_on_file = any(
                chess.square_file(p) == file
                for p in friendly_pawns
            )

            enemy_on_file = any(
                chess.square_file(p) == file
                for p in enemy_pawns
            )

            if not friendly_on_file and not enemy_on_file:
                score += sign * ROOK_OPEN_FILE_BONUS

            elif not friendly_on_file:
                score += sign * ROOK_SEMI_OPEN_FILE_BONUS

    return score


def get_evaluation(board):

    # Terminal positions
    if board.is_checkmate():
        return -CHECKMATE if board.turn == chess.WHITE else CHECKMATE

    if (
        board.is_stalemate()
        or board.is_insufficient_material()
        or board.is_seventyfive_moves()
        or board.is_fivefold_repetition()
    ):
        return 0

    phase = get_game_phase(board)

    score = get_material(board)

    score += get_piece_square_score(board, phase)
    score += get_bishop_pair_score(board)
    score += get_pawn_structure_score(board)
    score += get_rook_activity_score(board)

    return int(score)
