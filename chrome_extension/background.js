// Background Service Worker for 9-Cat Hoops Live Draft Analyzer
chrome.runtime.onInstalled.addListener(() => {
  console.log('[9-Cat Analyzer] Extension installed and ready.');
  chrome.storage.local.set({
    backendUrl: 'http://localhost:8000',
    puntedCats: [],
    draftType: 'snake',
    userTeamId: 1
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'FETCH_BACKEND_TEAM') {
    fetch(`${message.backendUrl}/analyze-team`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fantasy_link: message.fantasyLink })
    })
      .then(res => res.json())
      .then(data => sendResponse({ status: 'success', data }))
      .catch(err => sendResponse({ status: 'error', error: err.message }));
    return true;
  }

  if (message.action === 'PING_BACKEND') {
    fetch(`${message.backendUrl}/`)
      .then(res => res.json())
      .then(data => sendResponse({ status: 'success', data }))
      .catch(err => sendResponse({ status: 'error', error: err.message }));
    return true;
  }
});
