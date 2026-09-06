document.addEventListener('DOMContentLoaded', () => {
  const backendInput = document.getElementById('backend-url-input');
  const testBtn = document.getElementById('test-backend-btn');
  const statusMsg = document.getElementById('backend-status-msg');
  const leagueLinkInput = document.getElementById('league-link-input');
  const syncBtn = document.getElementById('sync-league-btn');
  const resetBtn = document.getElementById('reset-draft-btn');
  const statusDot = document.getElementById('status-dot');

  // Load saved settings
  chrome.storage.local.get(['backendUrl', 'fantasyLink'], (res) => {
    if (res.backendUrl) backendInput.value = res.backendUrl;
    if (res.fantasyLink) leagueLinkInput.value = res.fantasyLink;
  });

  // Save backend URL on change
  backendInput.addEventListener('change', () => {
    chrome.storage.local.set({ backendUrl: backendInput.value.trim() });
  });

  // Test backend connection
  testBtn.addEventListener('click', () => {
    const url = backendInput.value.trim();
    statusMsg.className = 'status-msg';
    statusMsg.textContent = 'Testing connection...';

    chrome.runtime.sendMessage(
      { action: 'PING_BACKEND', backendUrl: url },
      (res) => {
        if (res && res.status === 'success') {
          statusMsg.className = 'status-msg success';
          statusMsg.textContent = 'Backend connected successfully!';
          statusDot.className = 'status-dot connected';
        } else {
          statusMsg.className = 'status-msg error';
          statusMsg.textContent = 'Could not reach backend API.';
          statusDot.className = 'status-dot';
        }
      }
    );
  });

  // Sync league
  syncBtn.addEventListener('click', () => {
    const link = leagueLinkInput.value.trim();
    if (!link) {
      statusMsg.className = 'status-msg error';
      statusMsg.textContent = 'Please enter a Yahoo fantasy league URL.';
      return;
    }

    chrome.storage.local.set({ fantasyLink: link });
    statusMsg.className = 'status-msg';
    statusMsg.textContent = 'Fetching league data...';

    chrome.runtime.sendMessage(
      {
        action: 'FETCH_BACKEND_TEAM',
        backendUrl: backendInput.value.trim(),
        fantasyLink: link
      },
      (res) => {
        if (res && res.status === 'success') {
          statusMsg.className = 'status-msg success';
          statusMsg.textContent = 'League synced successfully!';
        } else {
          statusMsg.className = 'status-msg error';
          statusMsg.textContent = res?.error || 'Failed to sync league.';
        }
      }
    );
  });

  // Reset drafted players
  resetBtn.addEventListener('click', () => {
    chrome.storage.local.set({ draftedPlayers: [] }, () => {
      alert('Draft state reset.');
    });
  });
});
