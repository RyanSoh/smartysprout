import chess
import math

from .opening import play_opening
from .minimax import minimax


def get_move(board, depth):

    opening_move = play_opening(board)

    if opening_move:
        print("PLAYING OPENING MOVE:", opening_move)
        return opening_move, None

    legal_moves = list(board.legal_moves)

    if not legal_moves:
        return None, None

    maximizing = board.turn == chess.WHITE

    best_move = None
    best_eval = -math.inf if maximizing else math.inf

    for current_depth in range(1, depth + 1):

        iteration_best_move = None
        iteration_best_eval = (
            -math.inf if maximizing else math.inf
        )

        alpha = -math.inf
        beta = math.inf

        if best_move in legal_moves:
            ordered_moves = [best_move] + [
                move for move in legal_moves
                if move != best_move
            ]
        else:
            ordered_moves = legal_moves

        for move in ordered_moves:

            board.push(move)

            score = minimax(
                board,
                current_depth - 1,
                alpha,
                beta,
                board.turn
            )

            board.pop()

            if maximizing:
                if score > iteration_best_eval:
                    iteration_best_eval = score
                    iteration_best_move = move

                alpha = max(alpha, iteration_best_eval)

            else:
                if score < iteration_best_eval:
                    iteration_best_eval = score
                    iteration_best_move = move

                beta = min(beta, iteration_best_eval)

        if iteration_best_move is not None:
            best_move = iteration_best_move
            best_eval = iteration_best_eval

        print(
            f"Depth {current_depth}: "
            f"{best_move} | Evaluation: {best_eval}"
        )

    return best_move, best_eval