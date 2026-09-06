// 9-Cat Hoops Live Draft Analyzer Content Script
(function () {
  console.log('[9-Cat Hoops Analyzer] Live Draft extension loaded.');

  let allPlayers = typeof DEFAULT_PLAYERS !== 'undefined' ? DEFAULT_PLAYERS : [];
  let puntedCats = new Set();
  let searchQuery = '';
  let draftedPlayers = new Set();

  // Create floating trigger button
  function createToggleButton() {
    if (document.getElementById('hoops-draft-overlay-toggle')) return;

    const btn = document.createElement('button');
    btn.id = 'hoops-draft-overlay-toggle';
    btn.innerHTML = `<span>⚡ 9-Cat Draft Analyzer</span>`;
    btn.addEventListener('click', toggleOverlay);
    document.body.appendChild(btn);
  }

  // Create drawer overlay UI
  function createOverlayUI() {
    if (document.getElementById('hoops-draft-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'hoops-draft-overlay';
    overlay.className = 'hidden';

    overlay.innerHTML = `
      <div class="hoops-header">
        <div class="hoops-header-title">
          <span class="hoops-logo-badge">9-CAT</span>
          <h3>Live Draft Assistant</h3>
        </div>
        <button class="hoops-close-btn" id="hoops-close-btn">&times;</button>
      </div>

      <div class="hoops-controls">
        <div class="hoops-punt-title">Punt Strategy (Click to PUNT)</div>
        <div class="hoops-punt-grid" id="hoops-punt-chips"></div>
        <div class="hoops-search-box">
          <input type="text" id="hoops-search-input" class="hoops-search-input" placeholder="Search player name or position..." />
        </div>
      </div>

      <div class="hoops-table-container">
        <table class="hoops-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player</th>
              <th>Avg Z</th>
              <th>PTS</th>
              <th>REB</th>
              <th>AST</th>
              <th>STL</th>
              <th>BLK</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="hoops-player-rows"></tbody>
        </table>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('hoops-close-btn').addEventListener('click', toggleOverlay);
    document.getElementById('hoops-search-input').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderPlayerRows();
    });

    renderPuntChips();
    renderPlayerRows();
  }

  function toggleOverlay() {
    const overlay = document.getElementById('hoops-draft-overlay');
    if (overlay) {
      overlay.classList.toggle('hidden');
    }
  }

  function renderPuntChips() {
    const container = document.getElementById('hoops-punt-chips');
    if (!container || typeof ZScoreEngine === 'undefined') return;

    container.innerHTML = ZScoreEngine.CATEGORIES.map(cat => {
      const isPunted = puntedCats.has(cat.key);
      return `<button class="hoops-punt-chip ${isPunted ? 'active' : ''}" data-cat="${cat.key}">${cat.key}</button>`;
    }).join('');

    container.querySelectorAll('.hoops-punt-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const cat = btn.getAttribute('data-cat');
        if (puntedCats.has(cat)) puntedCats.delete(cat);
        else puntedCats.add(cat);
        renderPuntChips();
        renderPlayerRows();
      });
    });
  }

  function renderPlayerRows() {
    const tbody = document.getElementById('hoops-player-rows');
    if (!tbody || typeof ZScoreEngine === 'undefined') return;

    // Recalculate z-scores with current punt strategy
    const scoredPlayers = ZScoreEngine.computeDraftZScores(allPlayers, puntedCats);

    // Filter undrafted and search query
    const filtered = scoredPlayers.filter(p => {
      if (draftedPlayers.has(p.name)) return false;
      if (!searchQuery) return true;
      return (
        p.name.toLowerCase().includes(searchQuery) ||
        (p.positions && p.positions.toLowerCase().includes(searchQuery)) ||
        (p.team && p.team.toLowerCase().includes(searchQuery))
      );
    });

    tbody.innerHTML = filtered.map(p => {
      const zClass = ZScoreEngine.zScoreBadgeClass(p.avgZ);
      const s = p.ema_stats || {};
      const formatVal = (v) => v !== undefined && v !== null ? v.toFixed(1) : '-';

      return `
        <tr>
          <td><strong>#${p.overallRank}</strong></td>
          <td>
            <span class="hoops-player-name">${p.name}</span>
            <span class="hoops-player-sub">${p.team || ''} · ${p.positions || ''}</span>
          </td>
          <td><span class="z-badge ${zClass}">${p.avgZ > 0 ? '+' : ''}${p.avgZ.toFixed(2)}</span></td>
          <td>${formatVal(s.mu_pts)}</td>
          <td>${formatVal(s.mu_reb)}</td>
          <td>${formatVal(s.mu_ast)}</td>
          <td>${formatVal(s.mu_stl)}</td>
          <td>${formatVal(s.mu_blk)}</td>
          <td>
            <button class="hoops-draft-btn" data-name="${p.name}">Drafted</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.hoops-draft-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-name');
        draftedPlayers.add(name);
        renderPlayerRows();
      });
    });
  }

  // Auto-detect draft room changes from Yahoo / ESPN DOM
  function observeDraftRoomDOM() {
    const observer = new MutationObserver(() => {
      // Scrape Yahoo Fantasy live draft pick table if present
      const yahooDraftedNodes = document.querySelectorAll('.draft-table .player-name, .recent-picks .player-name, [data-tst="player-name"]');
      yahooDraftedNodes.forEach(node => {
        const txt = node.textContent ? node.textContent.trim() : '';
        if (txt) draftedPlayers.add(txt);
      });

      // Scrape ESPN live draft pick table if present
      const espnDraftedNodes = document.querySelectorAll('.draftTable .player-name, .PickHistory__Player');
      espnDraftedNodes.forEach(node => {
        const txt = node.textContent ? node.textContent.trim() : '';
        if (txt) draftedPlayers.add(txt);
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Initialize extension elements
  function init() {
    createToggleButton();
    createOverlayUI();
    observeDraftRoomDOM();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
