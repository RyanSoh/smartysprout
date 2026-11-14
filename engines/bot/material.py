
import chess


# Base material values in centipawns.
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}


def get_material(board):
    """
    Returns material balance from White's perspective.

    Uses modest positional adjustments for:
    - Bishop pair
    - Knight value in closed positions
    - Bishop value in open positions
    - Rook value in positions with fewer pawns
    """

    score = 0

    for color in (chess.WHITE, chess.BLACK):

        sign = 1 if color == chess.WHITE else -1

        pawns = len(board.pieces(chess.PAWN, color))
        enemy_pawns = len(board.pieces(chess.PAWN, not color))

        knights = len(board.pieces(chess.KNIGHT, color))
        bishops = len(board.pieces(chess.BISHOP, color))
        rooks = len(board.pieces(chess.ROOK, color))
        queens = len(board.pieces(chess.QUEEN, color))

        # Basic material
        score += sign * pawns * PIECE_VALUES[chess.PAWN]
        score += sign * knights * PIECE_VALUES[chess.KNIGHT]
        score += sign * bishops * PIECE_VALUES[chess.BISHOP]
        score += sign * rooks * PIECE_VALUES[chess.ROOK]
        score += sign * queens * PIECE_VALUES[chess.QUEEN]

        # Bishop pair
        if bishops >= 2:
            score += sign * 35

        # Pawn density affects minor-piece usefulness.
        total_pawns = pawns + enemy_pawns

        if total_pawns >= 12:
            # Closed positions generally favour knights.
            score += sign * knights * 5

        elif total_pawns <= 6:
            # Open positions generally favour bishops.
            score += sign * bishops * 5

        # Rooks become more effective as pawns disappear.
        score += sign * rooks * max(0, 8 - total_pawns) * 2

    return score

