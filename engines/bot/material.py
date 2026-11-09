
import chess

# Material values in centipawns.
PIECE_VALUES = {
    chess.PAWN: 100,
    chess.KNIGHT: 320,
    chess.BISHOP: 330,
    chess.ROOK: 500,
    chess.QUEEN: 900,
}


def get_material(board):
    """Returns material balance from White's perspective."""

    white_material = 0
    black_material = 0

    for piece_type, value in PIECE_VALUES.items():
        white_material += len(
            board.pieces(piece_type, chess.WHITE)
        ) * value

        black_material += len(
            board.pieces(piece_type, chess.BLACK)
        ) * value

    return white_material - black_material
