'use strict';

// ── Piece set ──────────────────────────────────────────────────────────────
const PIECE_STYLES = ['alpha', 'cburnett', 'chess7', 'governor', 'kosal'];
let currentPieceIdx = 0;

function cyclePieceStyle() {
  currentPieceIdx = (currentPieceIdx + 1) % PIECE_STYLES.length;
  renderBoard();
  if (editMode) renderEditorPalette();
}

// ── Board color schemes ────────────────────────────────────────────────────
const BOARD_COLORS = [
  { light: '#d8c6a0', dark: '#8a5a3a', selLight: '#f6f669', selDark: '#baca2b', lastLight: '#cdd16f88', lastDark: '#aaa23a88' },
  { light: '#eeeed2', dark: '#769656', selLight: '#f6f669', selDark: '#baca2b', lastLight: '#cdd16f88', lastDark: '#aaa23a88' },
  { light: '#dee3e6', dark: '#8ca2ad', selLight: '#f6f669', selDark: '#baca2b', lastLight: '#cdd16f88', lastDark: '#aaa23a88' },
];
let currentBoardColor = 0;

function cycleBoardColor() {
  const s = BOARD_COLORS[currentBoardColor = (currentBoardColor + 1) % BOARD_COLORS.length];
  const r = document.documentElement.style;
  r.setProperty('--light-sq',        s.light);
  r.setProperty('--dark-sq',         s.dark);
  r.setProperty('--light-sq-sel',    s.selLight);
  r.setProperty('--dark-sq-sel',     s.selDark);
  r.setProperty('--last-move-light', s.lastLight);
  r.setProperty('--last-move-dark',  s.lastDark);
}

const makePieceImg = (color, type) => {
  const key = color + type.toUpperCase();
  return `<img src="/static/pieces/${PIECE_STYLES[currentPieceIdx]}/${key}.svg" width="100%" height="100%" alt="${key}" draggable="false">`;
};

// ── Constants & state ──────────────────────────────────────────────────────
const FILES     = ['a','b','c','d','e','f','g','h'];
const RANKS     = ['8','7','6','5','4','3','2','1'];
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let state = {
  fen: START_FEN, baseFen: START_FEN,
  selected: null, legalTargets: new Set(), lastMove: null,
  flipped: false,
  root: null,     // sentinel root node; fen = baseFen, no uci/san
  current: null,  // node currently being viewed (root = initial position)
};

// ── Annotations (arrows + highlights) ────────────────────────────────────
const annotations = { highlights: new Set(), arrows: new Set() };
let _rightDragFrom   = null;
let _lastAnnotationFen = null;
const _SVG_NS = 'http://www.w3.org/2000/svg';

// ── Edit mode ─────────────────────────────────────────────────────────────
let editMode          = false;
let editBoard         = null;   // 8×8 array of {color,type}|null
let editorTurn        = 'w';
let _editVersion      = 0;      // incremented on each edit; drives renderBoard key
let editSelectedPiece = null;   // palette piece selected for click-to-place
let editorCastling    = new Set(); // active castling rights: K, Q, k, q

// ── Helpers ────────────────────────────────────────────────────────────────
const squareName = (f, r) => FILES[f] + RANKS[r];
const sqToCoords = sq    => [FILES.indexOf(sq[0]), RANKS.indexOf(sq[1])];
const fenTurn    = fen   => fen.split(' ')[1];

function parseFen(fen) {
  return fen.split(' ')[0].split('/').map(row => {
    const r = [];
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) r.push(null);
      else r.push({ color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() });
    }
    return r;
  });
}

// Memoized board parse — keyed on FEN, invalidated automatically.
let _cachedBoard = { fen: null, board: null };
function getBoard() {
  if (editMode) return editBoard;
  if (_cachedBoard.fen !== state.fen) {
    _cachedBoard.fen   = state.fen;
    _cachedBoard.board = parseFen(state.fen);
  }
  return _cachedBoard.board;
}

// ── DOM cache ──────────────────────────────────────────────────────────────
const dom = {};
function cacheDom() {
  for (const id of [
    'board', 'fen-input', 'engine-lines', 'lines-container', 'nps-display',
    'move-list', 'move-list-wrap', 'move-list-hint', 'engine-hint',
    'analyse-btn', 'cancel-btn',
    'multipv-slider', 'hash-slider', 'threads-slider',
    'multipv-val', 'hash-val', 'threads-val',
    'coords-file-top', 'coords-file-bottom', 'coords-rank-left', 'coords-rank-right',
    'material-bar-top', 'material-bar-bottom',
    'move-list-panel', 'editor-panel', 'editor-palette', 'editor-btn',
    'position-btn-row', 'pgn-input', 'load-game-btn',
    'turn-w-btn', 'turn-b-btn',
    'export-pgn-btn', 'copy-fen-btn',
    'eval-bar', 'eval-bar-label',
    'about-modal', 'about-body',
    'toast', 'var-menu',
  ]) dom[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);

  // SVG overlay — created once and preserved across board rebuilds.
  const svg = document.createElementNS(_SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 8 8');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
  svg.innerHTML = '<defs><filter id="arr-shadow"><feDropShadow dx="0" dy="0" stdDeviation="0.05" flood-color="rgba(0,0,0,0.5)"/></filter></defs>';
  dom.board.appendChild(svg);
  dom.boardSvg = svg;
}

function flashFenError() {
  dom.fenInput.style.borderColor = 'var(--accent)';
  setTimeout(() => { dom.fenInput.style.borderColor = ''; }, 600);
}

// ── Eval bar ───────────────────────────────────────────────────────────────
// The bar's black segment grows from the top; white fills the rest.
// `blackPct` is the percentage (0–100) of the bar that is black.
function updateEvalBar(score, cp) {
  const bar = dom.evalBar;
  if (!bar) return;
  let blackPct;
  if (cp === null) {
    blackPct = score.startsWith('-') ? 98 : 2;
  } else {
    const k = 0.0022;
    blackPct = 50 - 50 * Math.tanh(k * cp);
  }
  blackPct = Math.max(2, Math.min(98, blackPct));
  bar.querySelector('.eval-bar-black').style.flexBasis = `${blackPct}%`;
  bar.querySelector('.eval-bar-divider').style.top     = `${blackPct}%`;
  if (dom.evalBarLabel) dom.evalBarLabel.textContent = score;
}

function resetEvalBar() {
  const bar = dom.evalBar;
  if (!bar) return;
  bar.querySelector('.eval-bar-black').style.flexBasis = '50%';
  bar.querySelector('.eval-bar-divider').style.top     = '50%';
  if (dom.evalBarLabel) { dom.evalBarLabel.textContent = ''; }
}

// ── Toast ──────────────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, ms = 2800) {
  const t = dom.toast;
  t.textContent = msg;
  t.style.display = 'block';
  requestAnimationFrame(() => t.classList.add('visible'));
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.classList.remove('visible');
    setTimeout(() => { t.style.display = 'none'; }, 220);
    _toastTimer = null;
  }, ms);
}

// ── Game result ─────────────────────────────────────────────────────────────
// Result is stored as node.result on the terminal node and rendered inline
// at the end of the move list by renderMoveList.

// ── Variation context menu ──────────────────────────────────────────────────
let _varMenuNode = null; // node the menu was opened for

function openVarMenu(e, node) {
  e.preventDefault();
  e.stopPropagation();
  _varMenuNode = node;
  const menu = dom.varMenu;

  // Show "Promote" if this node or any ancestor up to root is a sideline.
  let cur = node;
  let isPromotable = false;
  while (cur.parent) {
    if (cur.parent.children[0] !== cur) { isPromotable = true; break; }
    cur = cur.parent;
  }
  menu.querySelector('.var-menu-item:first-child').style.display = isPromotable ? '' : 'none';

  menu.style.display = 'block';
  const x = Math.min(e.clientX, window.innerWidth  - menu.offsetWidth  - 8);
  const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;
}

function closeVarMenu() {
  dom.varMenu.style.display = 'none';
  _varMenuNode = null;
}

async function deleteVariation() {
  const node = _varMenuNode;
  closeVarMenu();
  if (!node || !node.parent) return;

  // If current position is inside the subtree being deleted, navigate to parent first.
  const isInSubtree = n => {
    let cur = state.current;
    while (cur) { if (cur === n) return true; cur = cur.parent; }
    return false;
  };
  if (isInSubtree(node)) await jumpTo(node.parent);

  // Remove node from parent's children.
  node.parent.children = node.parent.children.filter(c => c !== node);
  renderMoveList();
}

function promoteVariation() {
  const node = _varMenuNode;
  closeVarMenu();
  if (!node || !node.parent) return;

  // Walk up from the clicked node to find the first ancestor that is itself a
  // sideline (not children[0] of its parent). That's the variation root —
  // the single swap point for a one-level promotion.
  let cur = node;
  while (cur.parent && cur.parent.children[0] === cur) {
    cur = cur.parent;
  }
  if (!cur.parent) return; // already main line all the way up

  // Swap cur with children[0] at this single level.
  const siblings = cur.parent.children;
  const idx = siblings.indexOf(cur);
  siblings.splice(idx, 1);
  siblings.unshift(cur);

  // Prune anything that now exceeds MAX_DEPTH.
  const MAX_DEPTH = 5;
  function pruneDepth(n, depth) {
    if (depth >= MAX_DEPTH) { n.children = []; return; }
    if (n.children.length > 0) pruneDepth(n.children[0], depth);
    for (let i = 1; i < n.children.length; i++) pruneDepth(n.children[i], depth + 1);
  }
  pruneDepth(state.root, 0);

  // Navigate to root if the current node was pruned.
  const nodeStillExists = n => {
    if (n === state.root) return true;
    if (!n.parent) return false;
    return n.parent.children.includes(n) && nodeStillExists(n.parent);
  };
  if (!nodeStillExists(state.current)) jumpTo(state.root);

  renderMoveList();
}

// ── Analysis ───────────────────────────────────────────────────────────────
let _analysisSource = null;
let _systemInfo = null;   // cached /api/system_info response
let _pendingRender = null; // rAF handle for throttled line rendering

function stopAnalysis() {
  if (!_analysisSource) return Promise.resolve();
  _analysisSource.close();
  _analysisSource = null;
  if (_pendingRender !== null) { cancelAnimationFrame(_pendingRender); _pendingRender = null; }
  setAnalysisButtons(false);
  setEnginePanel('idle');
  return fetch('/api/analyse/cancel', { method: 'POST' });
}

const setAnalysisButtons = on => {
  dom.analyseBtn.style.display = on ? 'none'  : 'block';
  dom.cancelBtn.style.display  = on ? 'block' : 'none';
};

// Show or hide the engine output vs the idle hint.
// `state`: 'idle' | 'running' | 'hidden'
function setEnginePanel(state) {
  if (state === 'running') {
    dom.linesContainer.style.display = '';
    dom.engineHint.style.display     = 'none';
  } else if (state === 'idle') {
    dom.linesContainer.style.display = 'none';
    dom.engineHint.style.display     = '';
  } else { // 'hidden' — e.g. game over at terminal node
    dom.linesContainer.style.display = 'none';
    dom.engineHint.style.display     = 'none';
  }
}

function clearSelection() { state.selected = null; state.legalTargets = new Set(); }
function clearAnnotations() { annotations.highlights.clear(); annotations.arrows.clear(); }

// ── Game tree ─────────────────────────────────────────────────────────────
// Each node: { _id, parent, children[], uci, san, fen, terminal }
// root has uci/san = null. children[0] = main line, [1+] = sidelines.
let _nodeId = 0;
const makeNode = (parent, uci, san, fen, terminal) =>
  ({ _id: _nodeId++, parent, uci, san, fen, terminal, children: [] });

const makeRoot = fen => makeNode(null, null, null, fen, false);

function findNodeById(id, node = state.root) {
  if (!node) return null;
  if (node._id === id) return node;
  for (const c of node.children) { const f = findNodeById(id, c); if (f) return f; }
  return null;
}

function findNodeByFen(fen, node = state.root) {
  if (!node) return null;
  if (node.fen === fen) return node;
  for (const c of node.children) { const f = findNodeByFen(fen, c); if (f) return f; }
  return null;
}

// ── Position reset ──────────────────────────────────────────────────────────
// Shared position-reset used by loadFen, board editor confirm, and clearMoveList.
function applyNewPosition(fen) {
  state.baseFen = fen;
  state.root    = makeRoot(fen);
  state.current = state.root;
  state.fen     = fen;
  state.lastMove = null;
  clearSelection();
  clearAnnotations();
  resetEvalBar();
  dom.npsDisplay.textContent   = '';
  dom.linesContainer.innerHTML = '';
  setEnginePanel('idle');
  renderBoard();
  renderMoveList();
}

async function clearMoveList() {
  await stopAnalysis();
  applyNewPosition(state.baseFen);
}

// ── Board rendering ────────────────────────────────────────────────────────
function renderCoords() {
  const files = state.flipped ? [...FILES].reverse() : FILES;
  const ranks = state.flipped ? [...RANKS].reverse() : RANKS;
  const spans = arr => arr.map(x => `<span>${x}</span>`).join('');
  dom.coordsFileTop.innerHTML    = spans(files);
  dom.coordsFileBottom.innerHTML = spans(files);
  dom.coordsRankLeft.innerHTML   = spans(ranks);
  dom.coordsRankRight.innerHTML  = spans(ranks);
}

// Rebuild all 64 squares and pieces from scratch. Called only when the board
// structure changes (new FEN, flip, or piece style).
function _rebuildBoard() {
  // Remove square children but preserve the SVG overlay.
  for (const child of [...dom.board.children]) {
    if (child !== dom.boardSvg) child.remove();
  }
  renderCoords();
  const board = getBoard();
  for (let vr = 0; vr < 8; vr++) {
    for (let vf = 0; vf < 8; vf++) {
      const rf = visIdx(vf);
      const rr = visIdx(vr);
      const sq    = squareName(rf, rr);
      const piece = board[rr][rf];
      const div   = document.createElement('div');
      // Base classes only — overlay (selected, last-move, hints) added by _updateOverlay.
      div.className  = (rf + rr) % 2 === 0 ? 'square light' : 'square dark';
      div.dataset.sq = sq;
      if (piece) {
        const wrap = document.createElement('div');
        wrap.className = 'piece';
        wrap.innerHTML = makePieceImg(piece.color, piece.type);
        div.appendChild(wrap);
      }
      dom.board.appendChild(div);
    }
  }
}

// Update selection highlight, last-move highlight, and hint dots in-place,
// without touching piece elements. Called on every renderBoard().
function _updateOverlay() {
  for (const sq of dom.board.children) {
    const name = sq.dataset.sq;
    sq.classList.toggle('selected',  state.selected === name);
    sq.classList.toggle('last-move',
      !!state.lastMove && (state.lastMove.from === name || state.lastMove.to === name));

    const isTarget = state.legalTargets.has(name);
    let dot = sq.querySelector('.hint-dot');
    if (isTarget) {
      const hasPiece = !!sq.querySelector('.piece');
      if (!dot) { dot = document.createElement('div'); sq.appendChild(dot); }
      dot.className = 'hint-dot' + (hasPiece ? ' capture' : '');
    } else if (dot) {
      dot.remove();
    }
  }
}

// Key representing structural board state — only when this changes do we
// need to rebuild squares and pieces from scratch.
let _boardStructureKey = null;

function renderBoard() {
  const key = editMode
    ? `edit|${_editVersion}|${+state.flipped}|${currentPieceIdx}`
    : `${state.fen}|${+state.flipped}|${currentPieceIdx}`;
  if (_boardStructureKey !== key) { _boardStructureKey = key; _rebuildBoard(); }
  _updateOverlay();
  // Clear annotations whenever the position changes (normal mode only).
  if (!editMode && _lastAnnotationFen !== state.fen) {
    _lastAnnotationFen = state.fen;
    clearAnnotations();
  }
  renderAnnotations();
  const displayFen = editMode ? editBoardToFen() : state.fen;
  if (dom.fenInput.value !== displayFen) dom.fenInput.value = displayFen;
  if (!editMode) renderMaterialBars(state.fen);
}

// ── Arrows and highlights ──────────────────────────────────────────────────
// Compute the points of an arrow polygon in SVG viewBox coords (1 unit = 1 square).
function arrowPoints(vf1, vr1, vf2, vr2) {
  const cx1 = vf1 + 0.5, cy1 = vr1 + 0.5;
  const cx2 = vf2 + 0.5, cy2 = vr2 + 0.5;
  const dx = cx2 - cx1, dy = cy2 - cy1;
  const len = Math.hypot(dx, dy);
  const nx = dx / len, ny = dy / len; // unit direction
  const px = -ny,      py = nx;       // perpendicular

  const W  = 0.12;  // shaft half-width
  const AW = 0.25;  // arrowhead half-width
  const AL = 0.32;  // arrowhead length
  const SO = 0.28;  // shaft start offset from source center

  const pts = [
    [cx1 + nx*SO + px*W,  cy1 + ny*SO + py*W ],  // shaft start right
    [cx2 - nx*AL + px*W,  cy2 - ny*AL + py*W ],  // shaft end right
    [cx2 - nx*AL + px*AW, cy2 - ny*AL + py*AW],  // arrowhead base outer right
    [cx2,                 cy2                 ],  // tip
    [cx2 - nx*AL - px*AW, cy2 - ny*AL - py*AW],  // arrowhead base outer left
    [cx2 - nx*AL - px*W,  cy2 - ny*AL - py*W ],  // shaft end left
    [cx1 + nx*SO - px*W,  cy1 + ny*SO - py*W ],  // shaft start left
  ];
  return pts.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ');
}

function renderAnnotations() {
  // Remove all children except <defs>.
  for (const child of [...dom.boardSvg.children]) {
    if (child.tagName !== 'defs') child.remove();
  }

  for (const sq of annotations.highlights) {
    const [fc, fr] = sqToCoords(sq);
    const vf = visIdx(fc), vr = visIdx(fr);
    const el = document.createElementNS(_SVG_NS, 'rect');
    el.setAttribute('x', vf);         el.setAttribute('y', vr);
    el.setAttribute('width', 1);      el.setAttribute('height', 1);
    el.setAttribute('fill', 'rgba(255,30,30,0.5)');
    dom.boardSvg.appendChild(el);
  }

  for (const arrow of annotations.arrows) {
    const [fc1, fr1] = sqToCoords(arrow.slice(0, 2));
    const [fc2, fr2] = sqToCoords(arrow.slice(2, 4));
    const vf1 = visIdx(fc1), vr1 = visIdx(fr1);
    const vf2 = visIdx(fc2), vr2 = visIdx(fr2);
    const el = document.createElementNS(_SVG_NS, 'polygon');
    el.setAttribute('points', arrowPoints(vf1, vr1, vf2, vr2));
    el.setAttribute('fill', 'rgba(255,170,0,0.85)');
    el.setAttribute('filter', 'url(#arr-shadow)');
    dom.boardSvg.appendChild(el);
  }
}

// ── applyUci helpers (module-level so they're defined once) ───────────────
const _expand = rank => {
  const row = [];
  for (const ch of rank) {
    if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) row.push('.');
    else row.push(ch);
  }
  return row;
};
const _compress = row => {
  let s = '', n = 0;
  for (const ch of row) {
    if (ch === '.') { n++; }
    else { if (n) { s += n; n = 0; } s += ch; }
  }
  return n ? s + n : s;
};

// ── Drag and drop ──────────────────────────────────────────────────────────
const drag = { active: false, fromSq: null, clone: null, boardRect: null, startX: 0, startY: 0, moved: false, editPiece: null };

// Map a real file/rank index to its on-screen index, accounting for board flip.
const visIdx = i => state.flipped ? 7 - i : i;

// Start a drag: create the floating clone and mark the drag active. `pieceEl`
// is the source piece element to clone (and hide, if it lives on the board).
function beginDrag(e, { fromSq, editPiece, pieceEl, hideSource }) {
  drag.fromSq    = fromSq;
  drag.editPiece = editPiece;
  drag.startX    = e.clientX;
  drag.startY    = e.clientY;
  drag.moved     = false;
  drag.active    = true;
  drag.boardRect = dom.board.getBoundingClientRect();

  if (pieceEl) {
    const sqSize = drag.boardRect.width / 8;
    const clone  = pieceEl.cloneNode(true);
    clone.id = 'drag-clone';
    clone.style.cssText = `position:fixed;pointer-events:none;z-index:1000;opacity:0.92;`
      + `width:${sqSize * 0.86}px;height:${sqSize * 0.86}px;`
      + `left:${e.clientX - sqSize * 0.43}px;top:${e.clientY - sqSize * 0.43}px`;
    document.body.appendChild(clone);
    drag.clone = clone;
    if (hideSource) pieceEl.style.opacity = '0';
  }
  document.body.classList.add('dragging');
}

function onSquareMouseDown(e, sq, sqEl) {
  if (e.button !== 0) return;
  e.preventDefault();

  const [file, rank] = sqToCoords(sq);
  const piece = getBoard()[rank][file];

  if (editMode) {
    // If a palette piece is selected, clicking any board square places it.
    if (editSelectedPiece) {
      editBoard[rank][file] = { ...editSelectedPiece };
      _editVersion++;
      renderBoard();
      return;
    }
    if (!piece) return; // no palette selection, empty square — no-op
    beginDrag(e, {
      fromSq: sq,
      editPiece: { color: piece.color, type: piece.type },
      pieceEl: sqEl.querySelector('.piece'),
      hideSource: true,
    });
    return;
  }

  if (!piece || piece.color !== fenTurn(state.fen)) { onSquareClick(sq); return; }
  // Second click on the selected piece — deselect instead of starting a drag.
  if (state.selected === sq) { onSquareClick(sq); return; }

  beginDrag(e, {
    fromSq: sq,
    editPiece: null,
    pieceEl: sqEl.querySelector('.piece'),
    hideSource: true,
  });
  selectSquare(sq);
}

function onMouseMove(e) {
  if (!drag.active || !drag.clone) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) drag.moved = true;
  const sqSize = drag.boardRect.width / 8;
  drag.clone.style.left = `${e.clientX - sqSize * 0.43}px`;
  drag.clone.style.top  = `${e.clientY - sqSize * 0.43}px`;
}

function onMouseUp(e) {
  if (!drag.active) return;
  if (drag.clone) { drag.clone.remove(); drag.clone = null; }
  document.body.classList.remove('dragging');
  drag.active = false;

  if (editMode) {
    // Restore source piece opacity (board drag only).
    if (drag.fromSq) {
      const el = dom.board.querySelector(`[data-sq="${drag.fromSq}"] .piece`);
      if (el) el.style.opacity = '';
    }
    const target = squareAtPoint(e.clientX, e.clientY, drag.boardRect);

    if (drag.fromSq === null) {
      // Palette interaction.
      if (!drag.moved) {
        // Click (no drag): toggle selection on the palette piece.
        const p = drag.editPiece;
        editSelectedPiece = (editSelectedPiece?.color === p.color && editSelectedPiece?.type === p.type)
          ? null : p;
        renderEditorPalette();
        drag.editPiece = null;
        return;
      }
      // Drag from palette to board.
      if (target) {
        const [tf, tr] = sqToCoords(target);
        editBoard[tr][tf] = drag.editPiece;
        _editVersion++;
        renderBoard();
      }
    } else {
      // Board drag: remove from source, place on target (or discard if off-board).
      const [ff, fr] = sqToCoords(drag.fromSq);
      editBoard[fr][ff] = null;
      if (target) {
        const [tf, tr] = sqToCoords(target);
        editBoard[tr][tf] = drag.editPiece;
      }
      _editVersion++;
      renderBoard();
    }
    drag.fromSq = null; drag.editPiece = null;
    return;
  }

  const pieceEl = dom.board.querySelector(`[data-sq="${drag.fromSq}"] .piece`);
  if (pieceEl) pieceEl.style.opacity = '';
  if (!drag.moved) { drag.fromSq = null; return; }

  const target = squareAtPoint(e.clientX, e.clientY, drag.boardRect);
  const fromSq = drag.fromSq;
  drag.fromSq  = null;

  if (target && target !== fromSq && state.legalTargets.has(target)) {
    tryMove(fromSq, target);
  } else if (target !== fromSq) {
    clearSelection(); renderBoard();
  }
}

// Accepts a cached rect to avoid a reflow when called from onMouseUp.
function squareAtPoint(x, y, rect = dom.board.getBoundingClientRect()) {
  const sqSize = rect.width / 8;
  const vf = Math.floor((x - rect.left) / sqSize);
  const vr = Math.floor((y - rect.top)  / sqSize);
  if (vf < 0 || vf > 7 || vr < 0 || vr > 7) return null;
  return squareName(visIdx(vf), visIdx(vr));
}

document.addEventListener('mousemove', onMouseMove);
document.addEventListener('mouseup',   onMouseUp);

// ── Client-side legal move generation ─────────────────────────────────────
// Returns true if the square at (fc, fr) is attacked by any piece of byColor.
function isAttacked(board, sq, byColor) {
  const [fc, fr] = sqToCoords(sq);

  // Pawns: white attacks from row+1, black from row-1.
  const pRow = byColor === 'w' ? fr + 1 : fr - 1;
  for (const df of [-1, 1]) {
    const pf = fc + df;
    if (pf >= 0 && pf < 8 && pRow >= 0 && pRow < 8) {
      const p = board[pRow][pf];
      if (p?.color === byColor && p.type === 'p') return true;
    }
  }
  // Knights
  for (const [df, dr] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const nf = fc + df, nr = fr + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const p = board[nr][nf];
      if (p?.color === byColor && p.type === 'n') return true;
    }
  }
  // Rook / queen (straight rays)
  for (const [df, dr] of [[0,1],[0,-1],[1,0],[-1,0]]) {
    let nf = fc + df, nr = fr + dr;
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const p = board[nr][nf];
      if (p) { if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true; break; }
      nf += df; nr += dr;
    }
  }
  // Bishop / queen (diagonal rays)
  for (const [df, dr] of [[1,1],[1,-1],[-1,1],[-1,-1]]) {
    let nf = fc + df, nr = fr + dr;
    while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const p = board[nr][nf];
      if (p) { if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true; break; }
      nf += df; nr += dr;
    }
  }
  // King
  for (const [df, dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    const nf = fc + df, nr = fr + dr;
    if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
      const p = board[nr][nf];
      if (p?.color === byColor && p.type === 'k') return true;
    }
  }
  return false;
}

// Returns array of legal UCI moves from fromSq in fen.
function legalMovesFrom(fen, fromSq) {
  const [, turn, castling, epSq] = fen.split(' ');
  const opp   = turn === 'w' ? 'b' : 'w';
  const board = fen === state.fen ? getBoard() : parseFen(fen);
  const [fc, fr] = sqToCoords(fromSq);
  const piece = board[fr][fc];
  if (!piece || piece.color !== turn) return [];

  // Locate the king once — reused in every tryAdd call instead of scanning
  // all 64 squares after each candidate move.
  let kingF = -1, kingR = -1;
  outer: for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++)
      if (board[r][f]?.color === turn && board[r][f]?.type === 'k') {
        kingF = f; kingR = r; break outer;
      }

  const moves = [];

  function tryAdd(tc, tr, promo) {
    const uci    = fromSq + squareName(tc, tr) + (promo || '');
    const newBrd = parseFen(applyUci(fen, uci));
    // If the moving piece is the king, it's now at (tc, tr); otherwise the
    // king hasn't moved so we reuse the position found above.
    const kf = piece.type === 'k' ? tc : kingF;
    const kr = piece.type === 'k' ? tr : kingR;
    if (!isAttacked(newBrd, squareName(kf, kr), opp)) moves.push(uci);
  }

  function slide(dirs) {
    for (const [df, dr] of dirs) {
      let tc = fc + df, tr = fr + dr;
      while (tc >= 0 && tc < 8 && tr >= 0 && tr < 8) {
        const t = board[tr][tc];
        if (t?.color === turn) break;
        tryAdd(tc, tr);
        if (t) break;
        tc += df; tr += dr;
      }
    }
  }

  function jump(deltas) {
    for (const [df, dr] of deltas) {
      const tc = fc + df, tr = fr + dr;
      if (tc >= 0 && tc < 8 && tr >= 0 && tr < 8 && board[tr][tc]?.color !== turn) tryAdd(tc, tr);
    }
  }

  if (piece.type === 'p') {
    const dir      = turn === 'w' ? -1 : 1;
    const startRow = turn === 'w' ? 6 : 1;
    const promoRow = turn === 'w' ? 0 : 7;
    const promos   = ['q','r','b','n'];
    const tr1 = fr + dir;
    if (tr1 >= 0 && tr1 < 8 && !board[tr1][fc]) {
      if (tr1 === promoRow) { for (const p of promos) tryAdd(fc, tr1, p); }
      else {
        tryAdd(fc, tr1);
        const tr2 = fr + 2 * dir;
        if (fr === startRow && !board[tr2][fc]) tryAdd(fc, tr2);
      }
    }
    for (const df of [-1, 1]) {
      const tc = fc + df, tr = fr + dir;
      if (tc < 0 || tc >= 8 || tr < 0 || tr >= 8) continue;
      if (board[tr][tc]?.color === opp || (epSq !== '-' && squareName(tc, tr) === epSq)) {
        if (tr === promoRow) { for (const p of promos) tryAdd(tc, tr, p); }
        else tryAdd(tc, tr);
      }
    }
  } else if (piece.type === 'n') {
    jump([[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]);
  } else if (piece.type === 'b') {
    slide([[1,1],[1,-1],[-1,1],[-1,-1]]);
  } else if (piece.type === 'r') {
    slide([[0,1],[0,-1],[1,0],[-1,0]]);
  } else if (piece.type === 'q') {
    slide([[1,1],[1,-1],[-1,1],[-1,-1],[0,1],[0,-1],[1,0],[-1,0]]);
  } else if (piece.type === 'k') {
    jump([[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]);
    // Castling — standard positions only.
    if (turn === 'w' && fr === 7 && fc === 4) {
      if (castling.includes('K') && !board[7][5] && !board[7][6]
          && !isAttacked(board, 'e1', opp) && !isAttacked(board, 'f1', opp)) tryAdd(6, 7);
      if (castling.includes('Q') && !board[7][3] && !board[7][2] && !board[7][1]
          && !isAttacked(board, 'e1', opp) && !isAttacked(board, 'd1', opp)) tryAdd(2, 7);
    } else if (turn === 'b' && fr === 0 && fc === 4) {
      if (castling.includes('k') && !board[0][5] && !board[0][6]
          && !isAttacked(board, 'e8', opp) && !isAttacked(board, 'f8', opp)) tryAdd(6, 0);
      if (castling.includes('q') && !board[0][3] && !board[0][2] && !board[0][1]
          && !isAttacked(board, 'e8', opp) && !isAttacked(board, 'd8', opp)) tryAdd(2, 0);
    }
  }
  return moves;
}

// ── Click-to-move ──────────────────────────────────────────────────────────
function selectSquare(sq) {
  state.selected     = sq;
  state.legalTargets = new Set(legalMovesFrom(state.fen, sq).map(uci => uci.slice(2, 4)));
  renderBoard();
}

async function onSquareClick(sq) {
  if (state.selected && state.legalTargets.has(sq)) { await tryMove(state.selected, sq); return; }
  if (state.selected === sq) { clearSelection(); renderBoard(); return; }
  const [file, rank] = sqToCoords(sq);
  const piece = getBoard()[rank][file];
  if (piece && piece.color === fenTurn(state.fen)) selectSquare(sq);
  else { clearSelection(); renderBoard(); }
}

async function tryMove(from, to) {
  const [ff, fr] = sqToCoords(from);
  const piece    = getBoard()[fr][ff];
  const isPromo  = piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1');
  // Capture FEN before the optimistic update changes state.fen.
  const preMoveFen = state.fen;
  let promo = '';
  if (isPromo) {
    promo = await showPromotionDialog(fenTurn(state.fen));
    if (!promo) { clearSelection(); renderBoard(); return; }
  }
  const uci = from + to + promo;
  _optimisticMove(uci);
  await sendMove(uci, preMoveFen);
}

// Immediately render the board as if `uci` has been played, so there's no
// visible snap-back while the fetch is in flight. sendMove will overwrite this
// with the authoritative server state once it resolves.
function _optimisticMove(uci) {
  try {
    const newFen = applyUci(state.fen, uci);
    clearSelection();
    state.lastMove = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
    // Update state.fen so any renderBoard() call during the fetch latency
    // shows the correct position rather than snapping back to the old one.
    state.fen            = newFen;
    _cachedBoard.fen     = newFen;
    _cachedBoard.board   = parseFen(newFen);
    renderBoard();
  } catch {
    clearSelection();
  }
}

async function sendMove(uci, fen = state.fen) {
  let data;
  try {
    data = await fetch('/api/move', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ fen, move: uci }),
    }).then(r => r.json());
  } catch (e) {
    data = { error: String(e) };
  }

  if (data.error) {
    console.warn('Server rejected move:', data.error);
    // Revert the optimistic update — the board must match a tree node.
    state.fen      = state.current.fen;
    state.lastMove = state.current === state.root ? null
      : { from: state.current.uci.slice(0, 2), to: state.current.uci.slice(2, 4) };
    renderBoard();
    return;
  }

  // Count variation nesting depth: how many times the path to root steps via
  // a non-main-line edge (i.e. the node is not children[0] of its parent).
  // Plain main-line moves always have variation depth 0.
  let varDepth = 0, n = state.current;
  while (n.parent) {
    if (n.parent.children[0] !== n) varDepth++;
    n = n.parent;
  }

  // At max variation depth, overwrite rather than nesting deeper.
  const MAX_DEPTH = 5;
  let parent = state.current;
  if (varDepth >= MAX_DEPTH) {
    const hasOtherChildren = parent.children.some(c => c.uci !== uci);
    if (hasOtherChildren) showToast('Max subline depth exceeded — line overwritten');
    if (parent.children.length) parent.children = [];
  }

  const existing = parent.children.find(c => c.uci === uci);
  if (existing) {
    state.current = existing;
  } else {
    const node = makeNode(parent, uci, data.san || uci, data.fen, !!data.is_game_over);
    parent.children.push(node);
    state.current = node;
  }

  state.fen      = state.current.fen;
  state.lastMove = { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  renderBoard();
  renderMoveList();

  if (state.current.terminal) {
    await stopAnalysis();
    setEnginePanel('hidden');
    dom.linesContainer.innerHTML = '';
    const outcomeMap = { white: '1-0', black: '0-1', draw: '½-½' };
    state.current.result = outcomeMap[data.outcome] ?? '*';
    renderMoveList();
    return;
  }
  if (_analysisSource) { await stopAnalysis(); runAnalysis(); }
}

// ── Sacrifice / brilliant detection ────────────────────────────────────────
const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

function materialFromFen(fen) {
  const mat = { w: 0, b: 0 };
  for (const ch of fen.split(' ')[0]) {
    if (ch === '/' || (ch >= '1' && ch <= '8')) continue;
    mat[ch === ch.toUpperCase() ? 'w' : 'b'] += PIECE_VALUES[ch.toLowerCase()] || 0;
  }
  return mat;
}

function renderMaterialBars(fen) {
  if (!dom.materialBarTop || !dom.materialBarBottom) return;
  const mat  = materialFromFen(fen);
  const diff = mat.w - mat.b;

  // Which bar belongs to which side depends on flip state.
  // Top bar = black unflipped, white flipped.
  // Bottom bar = white unflipped, black flipped.
  const topIsWhite = state.flipped;

  // Show label only on the bar of the side that's ahead; clear the other.
  const whiteAhead = diff > 0;
  const blackAhead = diff < 0;
  const label = diff === 0 ? ''
    : `<span class="material-score">${diff > 0 ? '+' : ''}${diff}</span>`;

  const topAhead    = topIsWhite ? whiteAhead : blackAhead;
  const bottomAhead = topIsWhite ? blackAhead : whiteAhead;

  dom.materialBarTop.innerHTML    = topAhead    ? label : '';
  dom.materialBarBottom.innerHTML = bottomAhead ? label : '';
}

function applyUci(fen, uci) {
  const parts = fen.split(' ');
  const turn  = parts[1];
  let castling = parts[2] || '-';
  const board = parts[0].split('/').map(_expand);
  const fc = uci.charCodeAt(0) - 97, fr = 8 - +uci[1];
  const tc = uci.charCodeAt(2) - 97, tr = 8 - +uci[3];
  let piece = board[fr][fc];
  const isPawn   = piece.toLowerCase() === 'p';
  const captured = board[tr][tc] !== '.';
  board[fr][fc] = '.';

  if (isPawn && uci[0] !== uci[2] && !captured)  // en passant capture
    board[turn === 'w' ? tr + 1 : tr - 1][tc] = '.';
  if (uci[4]) piece = turn === 'w' ? uci[4].toUpperCase() : uci[4];
  if (piece.toLowerCase() === 'k') {
    if (uci === 'e1g1') { board[7][7] = '.'; board[7][5] = 'R'; }
    if (uci === 'e1c1') { board[7][0] = '.'; board[7][3] = 'R'; }
    if (uci === 'e8g8') { board[0][7] = '.'; board[0][5] = 'r'; }
    if (uci === 'e8c8') { board[0][0] = '.'; board[0][3] = 'r'; }
    castling = castling.replace(turn === 'w' ? /[KQ]/g : /[kq]/g, '');
  }
  board[tr][tc] = piece;

  // Rook moved from, or anything captured on, a corner square loses that right.
  const CORNER_RIGHTS = { h1: 'K', a1: 'Q', h8: 'k', a8: 'q' };
  for (const sq of [uci.slice(0, 2), uci.slice(2, 4)]) {
    const right = CORNER_RIGHTS[sq];
    if (right) castling = castling.replace(right, '');
  }
  if (!castling) castling = '-';

  const ep   = isPawn && Math.abs(tr - fr) === 2 ? uci[0] + (turn === 'w' ? '3' : '6') : '-';
  const half = isPawn || captured ? 0 : (+parts[4] || 0) + 1;
  const full = (+parts[5] || 1) + (turn === 'b' ? 1 : 0);

  return `${board.map(_compress).join('/')} ${turn === 'w' ? 'b' : 'w'} ${castling} ${ep} ${half} ${full}`;
}

function materialLoss(baseFen, pvUci) {
  if (!pvUci?.length) return 0;
  const stm  = baseFen.split(' ')[1];
  const opp  = stm === 'w' ? 'b' : 'w';
  const base = materialFromFen(baseFen);
  const baseImbalance = base[stm] - base[opp];

  let fen = baseFen, imbAt3 = baseImbalance, imbAt5 = baseImbalance;
  for (let i = 0; i < Math.min(5, pvUci.length); i++) {
    try { fen = applyUci(fen, pvUci[i]); } catch { break; }
    if (i === 2) { const m = materialFromFen(fen); imbAt3 = m[stm] - m[opp]; }
    if (i === 4) { const m = materialFromFen(fen); imbAt5 = m[stm] - m[opp]; }
  }
  return Math.max(baseImbalance - imbAt3, baseImbalance - imbAt5);
}

// ── Analysis output ────────────────────────────────────────────────────────
let _currentLines = null, _currentAnalysisFen = null;

function renderLines(lines, analysisFen) {
  // Cheap updates happen immediately every frame.
  const nps     = lines[0]?.nps;
  const depth   = lines[0]?.depth;
  const summary = [
    depth != null ? `depth ${depth}` : null,
    nps   != null ? `${Math.round(nps / 1000)}k nps` : null,
  ].filter(Boolean).join(' · ');
  dom.npsDisplay.textContent = summary;
  if (lines[0]) updateEvalBar(lines[0].score, lines[0].cp ?? null);

  // Stash latest data; the expensive innerHTML rebuild is throttled to one
  // paint per frame so a burst of SSE messages doesn't thrash the DOM.
  _currentLines = lines;
  _currentAnalysisFen = analysisFen;
  if (_pendingRender !== null) return;
  _pendingRender = requestAnimationFrame(() => {
    _pendingRender = null;
    _paintLines(_currentLines, _currentAnalysisFen);
  });
}

function _paintLines(lines, analysisFen) {
  dom.linesContainer.innerHTML = lines.map((line, li) => {
    const pos   = line.cp === null ? !line.score.startsWith('-') : line.cp >= 0;
    const badge = `score-badge score-badge-${pos ? 'white' : 'black'}`;
    const depth = line.seldepth != null ? `${line.depth}/${line.seldepth}` : `${line.depth}`;
    const loss  = materialLoss(analysisFen, line.pv_uci);
    const brill = loss > 2, sac = loss > 0;
    const cls   = brill ? ' brilliant' : sac ? ' sacrifice' : '';
    const icon  = brill ? '<span class="sacrifice-badge brilliant-badge">&#9733;</span>'
                : sac   ? '<span class="sacrifice-badge">&#9889;</span>' : '';
    const moves = line.pv_san.map((san, mi) =>
      `<span class="pv-move" data-line="${li}" data-move="${mi}">${san}</span>`).join(' ');
    return `<div class="engine-line${cls}"><div class="line-score-row">`
      + `<span class="${badge}">${line.score}</span><span class="line-depth">depth ${depth}</span>${icon}`
      + `</div><div class="line-moves">${moves}</div></div>`;
  }).join('');
}

async function applyPvLine(line, upToIndex, fromFen) {
  const wasRunning = !!_analysisSource;
  await stopAnalysis();

  // Start from the tree node that corresponds to the analysis position.
  let node = findNodeByFen(fromFen) ?? state.current;
  const pvUci = line.pv_uci.slice(0, upToIndex + 1);
  const pvSan = line.pv_san.slice(0, upToIndex + 1);
  let fen = node.fen;

  for (let i = 0; i < pvUci.length; i++) {
    const uci      = pvUci[i];
    const existing = node.children.find(c => c.uci === uci);
    if (existing) { node = existing; fen = node.fen; continue; }
    const data = await fetch('/api/move', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ fen, move: uci }),
    }).then(r => r.json());
    if (data.error) break;
    const child = makeNode(node, uci, data.san || pvSan[i], data.fen, !!data.is_game_over);
    node.children.push(child);
    node = child;
    fen  = node.fen;
  }

  await jumpTo(node);
  if (!node.terminal && wasRunning) runAnalysis();
}

async function runAnalysis() {
  if (_analysisSource) await stopAnalysis();
  setAnalysisButtons(true);
  setEnginePanel('running');
  dom.linesContainer.innerHTML  = '<div style="color:var(--text3);font-size:12px">Loading\u2026</div>';

  const analysisFen = state.fen;
  const multipv     = parseInt(dom.multipvSlider.value) || 3;
  const source      = new EventSource(`/api/analyse?fen=${encodeURIComponent(analysisFen)}&multipv=${multipv}`);
  _analysisSource   = source;

  const finish = () => { source.close(); _analysisSource = null; setAnalysisButtons(false); };

  source.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.error) {
      finish();
      const div = document.createElement('div');
      div.style.fontSize = '12px';
      div.textContent = data.error;
      dom.linesContainer.replaceChildren(div);
      return;
    }
    if (data.crashed) {
      finish();
      dom.linesContainer.innerHTML = '<div style="color:var(--accent);font-size:12px">Engine terminated unexpectedly.</div>';
      return;
    }
    if (data.lines?.length) renderLines(data.lines, analysisFen);
    if (data.done) finish(); // leave npsDisplay showing the last depth/nps as a summary
  };
  source.onerror = () => {
    console.error('Analysis stream error');
    finish();
  };
}

// ── Move list ──────────────────────────────────────────────────────────────
// Renders the main line as a grid (move-num | white | black).
// Variations are still rendered inline as wrapped spans inside a variation-block.
// Returns an HTML string; called recursively for sidelines.
function renderLine(node, mn, white, firstInLine = true, depth = 0, entrySiblings = []) {
  if (depth > 0) {
    let html = '';
    while (node) {
      const active = node === state.current;
      if (white || firstInLine) {
        html += `<span class="var-num">${mn}${white ? '.' : '\u2026'}</span>`;
      }
      firstInLine = false;
      html += `<span class="move-entry var-move${active ? ' active' : ''}" data-nid="${node._id}">${node.san}</span>`;

      if (node.children.length > 1) {
        for (let i = 1; i < node.children.length; i++) {
          html += `<div class="variation-block">`;
          html += renderLine(node.children[i], mn + (white ? 0 : 1), !white, true, depth + 1);
          html += `</div>`;
        }
      }
      if (white) { white = false; } else { white = true; mn++; }
      node = node.children[0] ?? null;
    }
    return html;
  }

  // Main line: grid rows.
  let html = '';
  let firstRow = true;
  // Sidelines carried forward from the previous black node's children[1+].
  // These are alternative white moves for the *current* row, so they must be
  // emitted after that row is rendered, not after the previous one.
  let pendingVars = '';

  while (node) {
    if (white) {
      const wNode   = node;
      const wActive = wNode === state.current;

      const bNode = wNode.children[0] ?? null;

      // Alternatives to wNode's black response (shown after this row).
      let wVars = '';
      if (wNode.children.length > 1) {
        for (let i = 1; i < wNode.children.length; i++) {
          wVars += `<div class="variation-block">`;
          wVars += renderLine(wNode.children[i], mn, false, true, 1);
          wVars += `</div>`;
        }
      }

      if (bNode) {
        const bActive = bNode === state.current;

        // Collect THIS row's alternative white continuations from bNode for
        // the NEXT row (they become pendingVars for the following iteration).
        let nextPending = '';
        if (bNode.children.length > 1) {
          for (let i = 1; i < bNode.children.length; i++) {
            nextPending += `<div class="variation-block">`;
            nextPending += renderLine(bNode.children[i], mn + 1, true, true, 1);
            nextPending += `</div>`;
          }
        }

        html += `<div class="ml-row">`;
        html += `<span class="move-num">${mn}.</span>`;
        html += `<span class="move-entry${wActive ? ' active' : ''}" data-nid="${wNode._id}">${wNode.san}</span>`;
        html += `<span class="move-entry${bActive ? ' active' : ''}" data-nid="${bNode._id}">${bNode.san}</span>`;
        html += `</div>`;

        // White sidelines (entrySiblings, pendingVars) always before black
        // sidelines (wVars), regardless of the order they were entered.
        html += pendingVars;
        if (firstRow && entrySiblings.length) {
          for (const sib of entrySiblings) {
            html += `<div class="variation-block">`;
            html += renderLine(sib, mn, true, true, 1);
            html += `</div>`;
          }
        }
        html += wVars;
        firstRow = false;
        pendingVars = nextPending;

        mn++;
        node = bNode.children[0] ?? null;
      } else {
        html += `<div class="ml-row">`;
        html += `<span class="move-num">${mn}.</span>`;
        html += `<span class="move-entry${wActive ? ' active' : ''}" data-nid="${wNode._id}">${wNode.san}</span>`;
        html += `<span></span>`;
        html += `</div>`;
        html += pendingVars;
        if (firstRow && entrySiblings.length) {
          for (const sib of entrySiblings) {
            html += `<div class="variation-block">`;
            html += renderLine(sib, mn, true, true, 1);
            html += `</div>`;
          }
        }
        html += wVars;
        firstRow = false;
        pendingVars = '';
        node = null;
      }
    } else {
      const bNode   = node;
      const bActive = bNode === state.current;

      // Alternative white moves for this black-first row.
      let nextPending = '';
      if (bNode.children.length > 1) {
        for (let i = 1; i < bNode.children.length; i++) {
          nextPending += `<div class="variation-block">`;
          nextPending += renderLine(bNode.children[i], mn + 1, true, true, 1);
          nextPending += `</div>`;
        }
      }

      html += `<div class="ml-row">`;
      html += `<span class="move-num">${mn}\u2026</span>`;
      html += `<span></span>`;
      html += `<span class="move-entry${bActive ? ' active' : ''}" data-nid="${bNode._id}">${bNode.san}</span>`;
      html += `</div>`;
      html += pendingVars;
      if (firstRow && entrySiblings.length) {
        for (const sib of entrySiblings) {
          html += `<div class="variation-block">`;
          html += renderLine(sib, mn, white, true, 1);
          html += `</div>`;
        }
      }
      firstRow = false;
      pendingVars = nextPending;

      white = true; mn++;
      node = bNode.children[0] ?? null;
    }
  }

  // Flush any remaining pendingVars after the last row.
  html += pendingVars;

  return html;
}

function renderMoveList() {
  if (!state.root?.children.length) {
    dom.moveList.innerHTML = '';
    dom.moveListHint.style.display = '';
    return;
  }
  dom.moveListHint.style.display = 'none';
  const parts      = state.root.fen.split(' ');
  const startWhite = parts[1] === 'w';
  const startMn    = parseInt(parts[5]) || 1;

  dom.moveList.innerHTML = renderLine(
    state.root.children[0], startMn, startWhite,
    true, 0, state.root.children.slice(1)
  );

  // Append result symbol if the main line ends on a terminal node.
  let tip = state.root;
  while (tip.children.length) tip = tip.children[0];
  if (tip.result) {
    dom.moveList.innerHTML += `<span class="result-symbol">${tip.result}</span>`;
  }

  requestAnimationFrame(() => {
    const active = dom.moveList.querySelector('.move-entry.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
    else if (state.current === state.root) dom.moveListWrap.scrollTop = 0;
  });
}

// ── History navigation ─────────────────────────────────────────────────────
async function jumpTo(node) {
  if (!node) return;
  const wasRunning = !!_analysisSource;
  if (wasRunning) await stopAnalysis();
  state.current  = node;
  state.fen      = node.fen;
  state.lastMove = node === state.root ? null
    : { from: node.uci.slice(0, 2), to: node.uci.slice(2, 4) };
  clearSelection();
  resetEvalBar();
  renderBoard(); renderMoveList();
  if (node.terminal) {
    setEnginePanel('hidden'); dom.linesContainer.innerHTML = '';
  } else if (wasRunning) {
    runAnalysis();
  } else {
    setEnginePanel('idle');
  }
}

async function resetToInitial() {
  await jumpTo(state.root);
}

async function stepBack() {
  await jumpTo(state.current?.parent ?? state.root);
}

async function stepForward() {
  if (state.current?.children.length) await jumpTo(state.current.children[0]);
}

async function jumpToTip() {
  let node = state.current;
  while (node?.children.length) node = node.children[0];
  if (node && node !== state.current) await jumpTo(node);
}

// ── Board controls ─────────────────────────────────────────────────────────
function flipBoard() { state.flipped = !state.flipped; renderBoard(); }

// ── About modal ────────────────────────────────────────────────────────────
let _aboutLoaded = false;

function _parseAboutText(text) {
  // Parse the patricia.txt format:
  //   - Lines consisting only of ━ are horizontal rules.
  //   - A non-empty line immediately AFTER a ━━━ line is a section header.
  //   - Everything else is body text, grouped into paragraphs by blank lines.
  //   - URLs are linkified.
  const linkify = s => s.replace(
    /(https?:\/\/[^\s)]+)/g,
    u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`
  );
  const escape = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                       .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const lines = text.split('\n');
  const out   = [];
  let para    = [];
  let prevWasRule = false;

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${linkify(escape(para.join(' ').trim()))}</p>`);
      para = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line   = lines[i];
    const isRule = /^━+\s*$/.test(line);

    if (isRule) {
      flushPara();
      out.push('<hr>');
      prevWasRule = true;
      continue;
    }
    if (prevWasRule && line.trim()) {
      // First non-empty line after a rule = section header.
      out.push(`<div class="about-section-title">${escape(line.trim())}</div>`);
      prevWasRule = false;
      continue;
    }
    prevWasRule = false;
    if (!line.trim()) {
      flushPara();
      continue;
    }
    para.push(line.trim());
  }
  flushPara();
  return out.join('\n');
}

async function showAbout() {
  dom.aboutModal.style.display = 'flex';
  if (_aboutLoaded) return;
  try {
    const text = await fetch('/api/about').then(r => r.text());
    dom.aboutBody.innerHTML = _parseAboutText(text);
    _aboutLoaded = true;  // only cache on success so a failed load retries
  } catch {
    dom.aboutBody.textContent = 'Could not load about text.';
  }
}

function hideAbout() {
  dom.aboutModal.style.display = 'none';
}

function loadGame() {
  dom.pgnInput.click();
}

async function loadFen(fen) {
  fen = fen.trim().replace(/\s+/g, ' ');
  const parts = fen.split(' ');
  const ranks = parts[0] ? parts[0].split('/') : [];
  if (parts.length < 2 || ranks.length !== 8 || !/^[wb]$/.test(parts[1])) {
    flashFenError();
    return;
  }
  // Pad missing fields with defaults so downstream code always sees 6 fields.
  const defaults = ['', 'w', '-', '-', '0', '1'];
  while (parts.length < 6) parts.push(defaults[parts.length]);
  await stopAnalysis();
  applyNewPosition(parts.join(' '));
}

// ── Export ────────────────────────────────────────────────────────────────
// Walk children[0] from root to collect the main line as {uci, san} pairs.
// Serialise the full game tree for PGN export (including all variations).
// Returns a recursive {uci, children[]} structure mirroring the tree nodes.
function collectTree(node) {
  return node.children.map(child => ({
    uci:      child.uci,
    children: collectTree(child),
  }));
}

// Flash a button label briefly, then restore it.
function _flashBtn(btn, msg, ms = 1500) {
  const orig = btn.textContent;
  btn.textContent = msg;
  btn.disabled    = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, ms);
}

async function exportPgn() {
  const btn  = dom.exportPgnBtn;
  const tree = collectTree(state.root);

  let pgn;
  try {
    const data = await fetch('/api/export_pgn', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ tree, starting_fen: state.baseFen }),
    }).then(r => r.json());

    if (data.error) { _flashBtn(btn, 'Export failed!'); return; }
    pgn = data.pgn;
  } catch {
    _flashBtn(btn, 'Export failed!');
    return;
  }

  // Download as a file.
  const blob = new Blob([pgn], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'patricia.pgn';
  a.click();
  URL.revokeObjectURL(url);

  // Also copy to clipboard for easy paste into Lichess / chess.com.
  try { await navigator.clipboard.writeText(pgn); } catch { /* clipboard optional */ }
  _flashBtn(btn, 'Exported!', 1200);
}

async function copyFen() {
  const btn = dom.copyFenBtn;
  try {
    await navigator.clipboard.writeText(state.fen);
    _flashBtn(btn, 'Copied!', 1200);
  } catch {
    _flashBtn(btn, 'Failed!');
  }
}

function showPromotionDialog(turn) {
  return new Promise(resolve => {
    const types  = ['q', 'r', 'b', 'n'];
    const style  = PIECE_STYLES[currentPieceIdx];
    const prefix = turn === 'w' ? 'w' : 'b';

    const modal = document.createElement('div');
    modal.className = 'promo-modal';

    const box = document.createElement('div');
    box.className = 'promo-box';

    for (const t of types) {
      const cell = document.createElement('div');
      cell.className = 'promo-piece';
      cell.dataset.p = t;
      const img = document.createElement('img');
      img.src    = `/static/pieces/${style}/${prefix}${t.toUpperCase()}.svg`;
      img.alt    = t;
      img.width  = 1;   // actual size via CSS
      img.height = 1;
      img.draggable = false;
      cell.appendChild(img);
      box.appendChild(cell);
    }

    modal.appendChild(box);

    // Position the modal over the board, centered.
    const boardRect = dom.board.getBoundingClientRect();
    modal.style.left   = `${boardRect.left}px`;
    modal.style.top    = `${boardRect.top}px`;
    modal.style.width  = `${boardRect.width}px`;
    modal.style.height = `${boardRect.height}px`;

    document.body.appendChild(modal);

    const close = result => { if (modal.parentNode) document.body.removeChild(modal); resolve(result); };
    box.querySelectorAll('.promo-piece').forEach(el =>
      (el.onclick = () => close(el.dataset.p)));
    modal.addEventListener('mousedown', e => { if (e.target === modal) close(null); });
  });
}

// ── Board editor ──────────────────────────────────────────────────────────
function editBoardToFen() {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let row = '', empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = editBoard[r][f];
      if (!p) { empty++; }
      else { if (empty) { row += empty; empty = 0; } row += p.color === 'w' ? p.type.toUpperCase() : p.type; }
    }
    rows.push(empty ? row + empty : row);
  }
  const castling = ['K','Q','k','q'].filter(r => editorCastling.has(r)).join('') || '-';
  return rows.join('/') + ` ${editorTurn} ${castling} - 0 1`;
}

function renderEditorPalette() {
  dom.editorPalette.innerHTML = ['w', 'b'].map(color =>
    `<div class="palette-row">${['k','q','r','b','n','p'].map(type => {
      const sel = editSelectedPiece?.color === color && editSelectedPiece?.type === type;
      return `<div class="palette-piece${sel ? ' palette-selected' : ''}" data-color="${color}" data-type="${type}">` +
        `<div class="piece">${makePieceImg(color, type)}</div></div>`;
    }).join('')}</div>`
  ).join('');
}

function setEditorTurn(turn) {
  editorTurn = turn;
  dom.turnWBtn.className = `btn${turn === 'w' ? ' btn-primary' : ''}`;
  dom.turnBBtn.className = `btn${turn === 'b' ? ' btn-primary' : ''}`;
}

function toggleCastling(right) {
  editorCastling[editorCastling.has(right) ? 'delete' : 'add'](right);
  updateCastlingButtons();
}

function updateCastlingButtons() {
  dom.editorPanel.querySelectorAll('[data-castle]').forEach(btn => {
    const active = editorCastling.has(btn.dataset.castle);
    btn.className = `btn castle-btn${active ? ' btn-primary castle-active' : ''}`;
  });
  if (editMode) dom.fenInput.value = editBoardToFen();
}

function clearEditBoard() {
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++)
      editBoard[r][f] = null;
  editorCastling.clear();
  updateCastlingButtons();
  _editVersion++;
  renderBoard();
}

function resetEditBoard() {
  editBoard = parseFen(START_FEN).map(row => row.map(p => p ? { ...p } : null));
  editorCastling = new Set(['K','Q','k','q']);
  setEditorTurn('w');
  updateCastlingButtons();
  _editVersion++;
  renderBoard();
}

function enterEditMode() {
  stopAnalysis();
  editMode  = true;
  editorTurn = fenTurn(state.fen);
  // Deep-copy current board into editBoard.
  editBoard = parseFen(state.fen).map(row => row.map(p => p ? { ...p } : null));
  _editVersion++;

  editSelectedPiece = null;
  const fenCastling = state.fen.split(' ')[2] || '-';
  editorCastling = new Set(fenCastling === '-' ? [] : fenCastling.split(''));
  clearSelection();
  clearAnnotations();
  state.lastMove = null;

  dom.moveListPanel.style.display  = 'none';
  dom.editorPanel.style.display    = '';
  dom.positionBtnRow.style.display = 'none';
  dom.exportPgnBtn.style.display   = 'none';
  dom.copyFenBtn.style.display     = 'none';
  dom.analyseBtn.disabled = true;
  resetEvalBar();
  if (dom.materialBarTop)    dom.materialBarTop.innerHTML    = '';
  if (dom.materialBarBottom) dom.materialBarBottom.innerHTML = '';

  setEditorTurn(editorTurn);
  renderEditorPalette();
  updateCastlingButtons();
  renderBoard();
}

function exitEditMode() {
  editMode          = false;
  editBoard         = null;
  editSelectedPiece = null;
  editorCastling    = new Set();

  dom.moveListPanel.style.display  = '';
  dom.editorPanel.style.display    = 'none';
  dom.positionBtnRow.style.display = '';
  dom.exportPgnBtn.style.display   = '';
  dom.copyFenBtn.style.display     = '';
  dom.analyseBtn.disabled = false;

  renderBoard();
  renderMoveList();
}

function toggleEditor() {
  if (!editMode) { enterEditMode(); return; }

  // Confirm: validate that each side has exactly one king.
  let wk = 0, bk = 0;
  for (let r = 0; r < 8; r++)
    for (let f = 0; f < 8; f++) {
      const p = editBoard[r][f];
      if (p?.type === 'k') { if (p.color === 'w') wk++; else bk++; }
    }

  let errorMsg = null;
  if (wk === 0 && bk === 0) errorMsg = 'No kings on board!';
  else if (wk === 0)         errorMsg = 'No white king!';
  else if (bk === 0)         errorMsg = 'No black king!';
  else if (wk > 1 && bk > 1) errorMsg = 'Too many kings!';
  else if (wk > 1)           errorMsg = 'Too many white kings!';
  else if (bk > 1)           errorMsg = 'Too many black kings!';

  if (errorMsg) {
    dom.editorBtn.textContent = errorMsg;
    dom.editorBtn.disabled    = true;
    setTimeout(() => { dom.editorBtn.textContent = 'Confirm board'; dom.editorBtn.disabled = false; }, 1500);
    return;
  }

  const fen = editBoardToFen();
  exitEditMode();
  applyNewPosition(fen);
  fetch('/api/new_game', { method: 'POST' });
}

// ── Engine options ─────────────────────────────────────────────────────────
function setSettingsSliders(disabled) {
  dom.multipvSlider.disabled = dom.hashSlider.disabled = dom.threadsSlider.disabled = disabled;
}

async function configureEngine(options) {
  await fetch('/api/engine/configure', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(options),
  });
}

async function onMultipvChange() {
  const wasRunning = !!_analysisSource;
  setSettingsSliders(true);
  try {
    if (wasRunning) { await stopAnalysis(); runAnalysis(); }
  } finally { setSettingsSliders(false); }
}

async function onHashChange(exp) {
  const wasRunning = !!_analysisSource;
  setSettingsSliders(true);
  try {
    let requestedExp = +exp;
    if (_systemInfo) {
      // Clamp to currently-available RAM so we never request more than the OS
      // can give. _systemInfo is refreshed each time the slider is released.
      try { _systemInfo = await fetch('/api/system_info').then(r => r.json()); } catch (_) {}
      const clampExp = Math.min(requestedExp, Math.floor(Math.log2(_systemInfo.available_hash_mb)));
      dom.hashSlider.max      = Math.floor(Math.log2(_systemInfo.max_hash_mb));
      dom.hashSlider.value    = clampExp;
      dom.hashVal.textContent = Math.pow(2, clampExp);
      requestedExp = clampExp;
    }
    if (wasRunning) await stopAnalysis();
    await configureEngine({ hash_mb: Math.pow(2, requestedExp) });
    if (wasRunning) runAnalysis();
  } finally { setSettingsSliders(false); }
}

async function onThreadsChange(val) {
  const wasRunning = !!_analysisSource;
  setSettingsSliders(true);
  try {
    if (wasRunning) await stopAnalysis();
    await configureEngine({ threads: +val });
    if (wasRunning) runAnalysis();
  } finally { setSettingsSliders(false); }
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  cacheDom();
  setEnginePanel('idle');
  // Initialise the game tree for the starting position.
  state.root    = makeRoot(START_FEN);
  state.current = state.root;
  renderBoard();

  // PGN file loader.
  dom.pgnInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    dom.pgnInput.value = ''; // reset so the same file can be reloaded

    const data = await fetch('/api/load_pgn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pgn: text }),
    }).then(r => r.json());

    if (data.error) {
      _flashBtn(dom.loadGameBtn, 'Load failed!');
      return;
    }

    await stopAnalysis();
    // Build the game tree from the flat move list.
    const root = makeRoot(data.starting_fen);
    let node   = root;
    for (const m of data.moves) {
      const child = makeNode(node, m.uci, m.san, m.fen, m.is_game_over);
      node.children.push(child);
      node = child;
    }
    state.baseFen = data.starting_fen;
    state.root    = root;
    state.current = node; // end of game
    state.fen     = node.fen;
    state.lastMove = data.moves.length
      ? { from: data.moves.at(-1).uci.slice(0, 2), to: data.moves.at(-1).uci.slice(2, 4) }
      : null;
    clearSelection();
    clearAnnotations();
    setEnginePanel('idle');
    dom.linesContainer.innerHTML  = '';
    renderBoard();
    renderMoveList();
    fetch('/api/new_game', { method: 'POST' });
  });

  // Delegated listeners: one per container instead of one per child.
  dom.board.addEventListener('contextmenu', e => e.preventDefault());
  dom.board.addEventListener('mousedown', e => {
    const sqEl = e.target.closest('[data-sq]');
    if (!sqEl) return;
    if (e.button === 2) {
      if (editMode) {
        // Right-click removes a piece from the edit board.
        const [fc, fr] = sqToCoords(sqEl.dataset.sq);
        if (editBoard[fr][fc]) { editBoard[fr][fc] = null; _editVersion++; renderBoard(); }
      } else {
        _rightDragFrom = sqEl.dataset.sq;
      }
      return;
    }
    if (e.button === 0) {
      if (!editMode && (annotations.highlights.size || annotations.arrows.size)) {
        clearAnnotations(); renderAnnotations();
      }
      onSquareMouseDown(e, sqEl.dataset.sq, sqEl);
    }
  });
  document.addEventListener('mouseup', e => {
    if (e.button !== 2 || !_rightDragFrom) return;
    const toEl = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-sq]');
    const toSq = toEl?.dataset.sq;
    if (toSq === _rightDragFrom) {
      annotations.highlights[annotations.highlights.has(toSq) ? 'delete' : 'add'](toSq);
    } else if (toSq) {
      const key = _rightDragFrom + toSq;
      annotations.arrows[annotations.arrows.has(key) ? 'delete' : 'add'](key);
    }
    _rightDragFrom = null;
    renderAnnotations();
  });
  dom.linesContainer.addEventListener('click', e => {
    const m = e.target.closest('.pv-move');
    if (m && _currentLines) applyPvLine(_currentLines[+m.dataset.line], +m.dataset.move, _currentAnalysisFen);
  });
  dom.moveList.addEventListener('click', e => {
    const entry = e.target.closest('.move-entry[data-nid]');
    if (entry) { const node = findNodeById(+entry.dataset.nid); if (node) jumpTo(node); }
  });
  dom.moveList.addEventListener('contextmenu', e => {
    const entry = e.target.closest('.move-entry[data-nid]');
    if (!entry) return;
    const node = findNodeById(+entry.dataset.nid);
    if (node && node.parent) openVarMenu(e, node);
  });
  document.addEventListener('click', e => {
    if (dom.varMenu.style.display !== 'none' && !dom.varMenu.contains(e.target)) closeVarMenu();
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideAbout(); closeVarMenu(); return; }
    // Don't steal keys when typing in an input/textarea.
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (editMode) return;
    switch (e.key) {
      case 'ArrowLeft':  e.preventDefault(); stepBack();       break;
      case 'ArrowRight': e.preventDefault(); stepForward();    break;
      case 'Home':       e.preventDefault(); resetToInitial(); break;
      case 'End':        e.preventDefault(); jumpToTip();      break;
    }
  });

  // Palette drag: picking a piece from the piece picker in edit mode.
  dom.editorPalette.addEventListener('mousedown', e => {
    if (!editMode || e.button !== 0) return;
    const item = e.target.closest('.palette-piece');
    if (!item) return;
    e.preventDefault();
    beginDrag(e, {
      fromSq: null,  // palette drag has no board source
      editPiece: { color: item.dataset.color, type: item.dataset.type },
      pieceEl: item.querySelector('.piece'),
      hideSource: false,
    });
  });

  // Show an initialising state immediately so the UI is never in limbo.
  dom.linesContainer.innerHTML = '<div style="color:var(--text3);font-size:11px">Initialising\u2026</div>';
  setEnginePanel('running');
  dom.analyseBtn.disabled = true;
  setSettingsSliders(true);

  // Heartbeat — keeps the server alive while the browser is open.
  // When the tab/window is closed, pings stop and the server shuts itself down.
  // Send one immediately on load so the watchdog window never opens before the
  // first scheduled ping (which would otherwise fire 3s later).
  fetch('/api/heartbeat', { method: 'POST' });
  setInterval(() => fetch('/api/heartbeat', { method: 'POST' }), 3000);
  // When the tab is hidden and re-shown, the browser may have throttled or
  // suspended the interval timer. Send an immediate heartbeat on visibility
  // change so the server watchdog is reset before it can expire.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      fetch('/api/heartbeat', { method: 'POST' });
  });

  try {
    const info   = await fetch('/api/system_info').then(r => r.json());
    _systemInfo  = info;

    // Surface a clear warning immediately if the engine binary wasn't found.
    if (!info.engine_ok) {
      const pathMsg = info.engine_path
        ? `Expected at: ${info.engine_path}`
        : 'Check ENGINE_PATH environment variable or default static/patricia/ location.';
      dom.linesContainer.innerHTML =
        `<div class="engine-missing">⚠ Engine not found.<br><br>${pathMsg}<br><br>` +
        `Place the patricia binary there and restart the server.</div>`;
      setEnginePanel('running');
      // Leave analyseBtn disabled — engine is missing.
    } else {
      setEnginePanel('idle');
      dom.analyseBtn.disabled = false;
    }

    const maxExp = Math.floor(Math.log2(Math.min(info.max_hash_mb, info.available_hash_mb)));
    const defExp = Math.min(5, maxExp); // 2^5 = 32 MB default
    dom.hashSlider.max      = maxExp;
    dom.hashSlider.value    = defExp;
    dom.hashVal.textContent = Math.pow(2, defExp);
    dom.hashSlider.addEventListener('change', e => onHashChange(e.target.value));
    await configureEngine({ hash_mb: Math.pow(2, defExp) });

    dom.threadsSlider.max      = info.max_threads;
    dom.threadsSlider.value    = 1;
    dom.threadsVal.textContent = 1;
    dom.threadsSlider.addEventListener('change', e => onThreadsChange(e.target.value));
    dom.multipvSlider.addEventListener('change', () => onMultipvChange());
  } catch (e) {
    console.warn('Could not fetch system info:', e);
    dom.linesContainer.innerHTML = '<div class="engine-missing">⚠ Could not contact server.</div>';
    setEnginePanel('running');
  } finally {
    setSettingsSliders(false);
  }
});