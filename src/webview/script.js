// This script runs in the context of the webview panel

// Get a reference to the VS Code API specific to the webview
const vscode = acquireVsCodeApi();

const messagesContainer = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

// Store pending confirmation details
let pendingConfirmation = null;

// Function to add a message to the chat display
function addMessage(sender, text, options = {}) {
    const messageElement = document.createElement('div');
    messageElement.classList.add('message', sender); // 'user' or 'bot' or 'error'

    // Use textContent for simple text to prevent XSS
    const textNode = document.createTextNode(text);
    messageElement.appendChild(textNode);

    messagesContainer.appendChild(messageElement);

    messagesContainer.scrollTop = messagesContainer.scrollHeight; // Scroll to bottom
}

// Handle sending messages
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (event) => {
    // Send message on Enter key press, unless Shift is also held (for newlines)
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // Prevent adding a newline character to the textarea
        sendMessage();
    }
});

function sendMessage() {
    const text = messageInput.value.trim();
    if (text) {
        // Display user message immediately in the UI
        addMessage('user', text);
        // Send the message content to the extension host
        vscode.postMessage({
            type: 'userMessage',
            text: text
        });
        // Clear the input field
        messageInput.value = '';
    }
}

// Handle messages received from the extension host
window.addEventListener('message', event => {
    const message = event.data; // The JSON data sent from the extension host
    switch (message.type) {
        case 'botMessage':
            addMessage('bot', message.text);
            break;
        case 'error':
             addMessage('error', message.text);
             break;
        case 'info': // Handle informational messages from the extension
             addMessage('info', message.text);
             break;
        case 'confirmFileWrite':
            // Store details needed for apply/discard
            pendingConfirmation = {
                originalUri: message.originalUri,
                proposedContent: message.proposedContent
            };
            // Display confirmation message and buttons
            addConfirmationPrompt(message.filePath);
            break;
    }
});

// Function to add the confirmation prompt with buttons
function addConfirmationPrompt(filePath) {
    const promptElement = document.createElement('div');
    promptElement.classList.add('message', 'confirmation');
    promptElement.textContent = `Apply proposed changes to ${filePath}? `; // Basic prompt

    const applyButton = document.createElement('button');
    applyButton.textContent = 'Apply';
    applyButton.onclick = handleApplyConfirm; // Use named function

    const discardButton = document.createElement('button');
    discardButton.textContent = 'Discard';
    discardButton.onclick = handleDiscardConfirm; // Use named function

    promptElement.appendChild(applyButton);
    promptElement.appendChild(discardButton);

    messagesContainer.appendChild(promptElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Event handlers for confirmation buttons
function handleApplyConfirm() {
    if (pendingConfirmation) {
        vscode.postMessage({ type: 'applyFileWrite', ...pendingConfirmation });
        clearConfirmation(); // Remove prompt after action
    }
}

// Optional: Consider implementing state restoration for a better user experience
// This allows the webview to retain its state if VS Code hides/restores it.
/*
const previousState = vscode.getState();
if (previousState && Array.isArray(previousState.history)) {
    console.log("Restoring previous state:", previousState);
    // Assuming state was saved as an array of { sender: 'user'/'bot'/'error', text: '...' }
    previousState.history.forEach(msg => {
        if (msg && msg.sender && typeof msg.text === 'string') {
             addMessage(msg.sender, msg.text);
        }
    });
}

// Example of saving state (call this when history changes)
function saveState(history) {
     vscode.setState({ history: history });
}
*/

// Function to remove confirmation prompts (optional, for cleanup)
function clearConfirmation() {
    pendingConfirmation = null;
    const confirmationElements = messagesContainer.querySelectorAll('.confirmation');
    confirmationElements.forEach(el => {
        // You could remove the element, or just disable buttons/change text
        el.querySelectorAll('button').forEach(btn => btn.disabled = true);
        const status = document.createElement('span');
        status.textContent = ' (Action taken)';
        el.appendChild(status);
    });
}
