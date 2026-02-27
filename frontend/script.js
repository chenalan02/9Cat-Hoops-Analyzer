// frontend/script.js

const analyzeBtn = document.getElementById('analyze-btn');
const inputScreen = document.getElementById('input-screen');
const resultScreen = document.getElementById('result-screen');
const linkInput = document.getElementById('team-link-input');
const loadingMsg = document.getElementById('loading-msg');
const displayLink = document.getElementById('display-link');

// The "Button Click" action
analyzeBtn.addEventListener('click', async () => {
    
    // 1. Get the value from the input box
    const userLink = linkInput.value;
    
    if (!userLink) {
        alert("Please paste a link first!");
        return;
    }

    // Show loading text
    loadingMsg.style.display = 'block';
    analyzeBtn.disabled = true;

    // 2. CALL THE BACKEND (The Endpoint bridge)
    try {
        // We use 'fetch' to send a request to the URL you defined
        const response = await fetch('http://127.0.0.1:8000/analyze-team', {
            method: 'POST', // The standard verb you defined
            headers: {
                'Content-Type': 'application/json', // We are sending JSON
            },
            // We package the input into JSON matching your Pydantic model
            body: JSON.stringify({ fantasy_link: userLink }), 
        });

        const data = await response.json(); // Parse the response

        // 3. HANDLE THE RESULT
        if (data.status === 'success') {
            // State change: Swap screens!
            inputScreen.style.display = 'none';
            resultScreen.style.display = 'block';
            displayLink.innerText = userLink; // Just to show something changed
        } else {
            alert("Backend error: " + data.message);
        }

    } catch (error) {
        console.error('Error connecting to API:', error);
        alert("Could not connect to the Python backend. Is uvicorn running at :8000?");
    } finally {
        // Reset button state
        loadingMsg.style.display = 'none';
        analyzeBtn.disabled = false;
    }
});