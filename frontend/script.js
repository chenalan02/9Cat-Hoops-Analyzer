// frontend/script.js

// DOM References
const inputScreen = document.getElementById('input-screen');
const resultScreen = document.getElementById('result-screen');
const linkInput = document.getElementById('team-link-input');
const analyzeBtn = document.getElementById('analyze-btn');
const loadingMsg = document.getElementById('loading-msg');
const backBtn = document.getElementById('back-btn');
const navHome = document.getElementById('nav-home');
const navDashboard = document.getElementById('nav-dashboard');
const navLogo = document.getElementById('nav-logo');
const categoryGrid = document.getElementById('category-grid');
const overviewBar = document.getElementById('overview-bar');
const previewGrid = document.getElementById('category-preview-grid');

// Category Definitions & Mock Data
const CATEGORIES = [
    { key: 'PTS', name: 'Points', icon: '🔥' },
    { key: 'REB', name: 'Rebounds', icon: '🏀' },
    { key: 'AST', name: 'Assists', icon: '🎯' },
    { key: 'STL', name: 'Steals', icon: '🖐️' },
    { key: 'BLK', name: 'Blocks', icon: '🚫' },
    { key: '3PM', name: '3-Pointers Made', icon: '🎱' },
    { key: 'FG%', name: 'Field Goal %', icon: '📈' },
    { key: 'FT%', name: 'Free Throw %', icon: '🎯' },
    { key: 'TO', name: 'Turnovers', icon: '⚠️' },
];

const MOCK_DATA = {
    PTS: [
        { name: 'Jayson Tatum', value: '27.4' },
        { name: 'Shai Gilgeous-Alexander', value: '26.8' },
        { name: 'Donovan Mitchell', value: '24.1' },
        { name: 'De\'Aaron Fox', value: '23.5' },
        { name: 'CJ McCollum', value: '21.2' },
    ],
    REB: [
        { name: 'Domantas Sabonis', value: '12.8' },
        { name: 'Nikola Vucevic', value: '10.3' },
        { name: 'Jayson Tatum', value: '9.2' },
        { name: 'Scottie Barnes', value: '8.5' },
        { name: 'De\'Aaron Fox', value: '5.4' },
    ],
    AST: [
        { name: 'De\'Aaron Fox', value: '8.1' },
        { name: 'Shai Gilgeous-Alexander', value: '6.4' },
        { name: 'Donovan Mitchell', value: '5.9' },
        { name: 'Domantas Sabonis', value: '5.8' },
        { name: 'CJ McCollum', value: '4.7' },
    ],
    STL: [
        { name: 'De\'Aaron Fox', value: '1.8' },
        { name: 'Shai Gilgeous-Alexander', value: '1.6' },
        { name: 'Donovan Mitchell', value: '1.4' },
        { name: 'Scottie Barnes', value: '1.2' },
        { name: 'Jayson Tatum', value: '1.1' },
    ],
    BLK: [
        { name: 'Scottie Barnes', value: '1.3' },
        { name: 'Jayson Tatum', value: '0.9' },
        { name: 'Nikola Vucevic', value: '0.8' },
        { name: 'Domantas Sabonis', value: '0.6' },
        { name: 'De\'Aaron Fox', value: '0.4' },
    ],
    '3PM': [
        { name: 'CJ McCollum', value: '3.1' },
        { name: 'Donovan Mitchell', value: '2.9' },
        { name: 'Jayson Tatum', value: '2.8' },
        { name: 'Shai Gilgeous-Alexander', value: '1.9' },
        { name: 'Scottie Barnes', value: '1.1' },
    ],
    'FG%': [
        { name: 'Domantas Sabonis', value: '.578' },
        { name: 'Nikola Vucevic', value: '.512' },
        { name: 'Shai Gilgeous-Alexander', value: '.509' },
        { name: 'Scottie Barnes', value: '.489' },
        { name: 'Jayson Tatum', value: '.471' },
    ],
    'FT%': [
        { name: 'CJ McCollum', value: '.904' },
        { name: 'Shai Gilgeous-Alexander', value: '.892' },
        { name: 'De\'Aaron Fox', value: '.867' },
        { name: 'Donovan Mitchell', value: '.855' },
        { name: 'Jayson Tatum', value: '.841' },
    ],
    TO: [
        { name: 'CJ McCollum', value: '1.6' },
        { name: 'Nikola Vucevic', value: '1.8' },
        { name: 'Scottie Barnes', value: '2.1' },
        { name: 'Jayson Tatum', value: '2.6' },
        { name: 'De\'Aaron Fox', value: '3.2' },
    ],
};

const OVERVIEW_STATS = [
    { label: 'PTS', value: '24.6' },
    { label: 'REB', value: '9.2' },
    { label: 'AST', value: '6.2' },
    { label: 'STL', value: '1.4' },
    { label: 'BLK', value: '0.8' },
    { label: '3PM', value: '2.4' },
    { label: 'FG%', value: '.492' },
    { label: 'FT%', value: '.872' },
    { label: 'TO', value: '2.3' },
];

// Renderers

/** Build the category preview cards on the input screen */
function renderCategoryPreview() {
    previewGrid.innerHTML = CATEGORIES.map(cat => `
    <div class="card">
      <div class="card-header">
        <h3>${cat.name}</h3>
        <span class="card-icon">${cat.icon}</span>
      </div>
      <div class="stat-row">
        <span class="stat-name" style="color: var(--text-secondary); font-size: 0.82rem;">
          Track your roster's ${cat.key} performance
        </span>
      </div>
    </div>
  `).join('');
}

/** Build a single stat card with a ranked top-5 list */
function buildCategoryCard(cat) {
    const players = MOCK_DATA[cat.key] || [];
    const rows = players.map((p, i) => `
    <div class="stat-row">
      <span class="stat-rank">#${i + 1}</span>
      <span class="stat-name">${p.name}</span>
      <span class="stat-value">${p.value}</span>
    </div>
  `).join('');

    return `
    <div class="card">
      <div class="card-header">
        <h3>${cat.name}</h3>
        <span class="card-icon">${cat.icon}</span>
      </div>
      ${rows}
    </div>
  `;
}

/** Render the full dashboard */
function renderDashboard() {
    // Overview bar
    overviewBar.innerHTML = OVERVIEW_STATS.map(s => `
    <div class="overview-stat">
      <div class="label">${s.label}</div>
      <div class="value">${s.value}</div>
    </div>
  `).join('');

    // Category cards
    categoryGrid.innerHTML = CATEGORIES.map(buildCategoryCard).join('');
}

// Screen Navigation

function showInput() {
    resultScreen.classList.add('hidden');
    inputScreen.classList.remove('hidden');
    inputScreen.classList.remove('screen');
    void inputScreen.offsetWidth; // trigger reflow for animation
    inputScreen.classList.add('screen');
    setActiveNav('home');
}

function showResult() {
    inputScreen.classList.add('hidden');
    resultScreen.classList.remove('hidden');
    resultScreen.classList.remove('screen');
    void resultScreen.offsetWidth;
    resultScreen.classList.add('screen');
    setActiveNav('dashboard');
}

function setActiveNav(page) {
    navHome.classList.toggle('active', page === 'home');
    navDashboard.classList.toggle('active', page === 'dashboard');
}

// Event Handlers

analyzeBtn.addEventListener('click', async () => {
    const userLink = linkInput.value.trim();

    if (!userLink) {
        alert('Please paste a fantasy team link first!');
        return;
    }

    // Show loading state
    loadingMsg.classList.add('visible');
    analyzeBtn.disabled = true;

    try {
        const response = await fetch('http://127.0.0.1:8000/analyze-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fantasy_link: userLink }),
        });

        const data = await response.json();

        if (data.status === 'success') {
            renderDashboard();
            showResult();
        } else {
            alert('Backend error: ' + data.message);
        }

    } catch (error) {
        // Backend not running — show dashboard with mock data anyway for demo
        console.warn('Backend not reachable, using mock data:', error.message);
        renderDashboard();
        showResult();
    } finally {
        loadingMsg.classList.remove('visible');
        analyzeBtn.disabled = false;
    }
});

backBtn.addEventListener('click', showInput);

navHome.addEventListener('click', (e) => {
    e.preventDefault();
    showInput();
});

navDashboard.addEventListener('click', (e) => {
    e.preventDefault();
    // Only navigate if we have results to show
    if (!resultScreen.classList.contains('hidden')) return;
});

navLogo.addEventListener('click', showInput);

// Allow Enter key to trigger analyze
linkInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') analyzeBtn.click();
});

// Init
renderCategoryPreview();