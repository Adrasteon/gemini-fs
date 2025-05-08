// @ts-ignore
const vscode = acquireVsCodeApi();
let currentFilePath = null;
let currentFileContent = null;

// Define constants for message commands to improve maintainability and reduce typos
const MESSAGE_COMMANDS = {
    GET_API_KEY: 'getApiKey',
    SEND_TO_GEMINI: 'sendToGemini',
    API_KEY: 'apiKey',
    GEMINI_RESPONSE: 'geminiResponse',
    FILE_CONTENT: 'fileContent',
    APPLY_CHANGES: 'applyChanges',
    DISCARD_CHANGES: 'discardChanges',
    CHANGES_APPLIED: 'changesApplied',
    CHANGES_DISCARDED: 'changesDiscarded',
    ERROR: 'error',
};

function requestApiKey() {
    vscode.postMessage({ command: MESSAGE_COMMANDS.GET_API_KEY });
}

document.addEventListener('DOMContentLoaded', () => {
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input');
    const chatMessages = document.getElementById('chat-messages');
    const filePreview = document.getElementById('file-preview');
    const fileNameElement = document.getElementById('file-name');

    // Defensive check for essential elements
    if (!sendButton || !messageInput || !chatMessages || !filePreview || !fileNameElement) {
        console.error('One or more essential UI elements are missing from the DOM.');
        // Optionally, display an error message in the webview UI
        return;
    }

    // Request API key on load
    requestApiKey();

    sendButton.addEventListener('click', () => {
        const message = messageInput.value;
        if (message.trim() !== '') {
            appendMessage('You', message);
            vscode.postMessage({ command: MESSAGE_COMMANDS.SEND_TO_GEMINI, text: message }); // Removed double quotes around the object
            messageInput.value = '';
        }
    });

    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendButton.click();
        }
    });

    // --- Message Handlers ---
    const commandHandlers = {
        [MESSAGE_COMMANDS.API_KEY]: (message) => {
            console.log("API Key received (or not) by webview:", message.key ? "Exists" : "Not set");
            // TODO: You might want to enable/disable UI elements based on API key presence
            // For example: messageInput.disabled = !message.key; sendButton.disabled = !message.key;
        },
        [MESSAGE_COMMANDS.GEMINI_RESPONSE]: (message) => {
            appendMessage('Gemini', message.text);
        },
        [MESSAGE_COMMANDS.FILE_CONTENT]: (message) => {
            currentFilePath = message.filePath;
            currentFileContent = message.content;
            fileNameElement.textContent = `File: ${message.filePath}`;
            
            const preElement = document.createElement('pre');
            const codeElement = document.createElement('code');
            // Basic syntax highlighting for diff (very rudimentary)
            const lines = message.diff.split('\n');
            lines.forEach(line => {
                const span = document.createElement('span');
                if (line.startsWith('+')) {
                    span.className = 'diff-added';
                } else if (line.startsWith('-')) {
                    span.className = 'diff-removed';
                }
                span.textContent = line + '\n'; // textContent is safer
                codeElement.appendChild(span);
            });

            preElement.appendChild(codeElement);
            filePreview.innerHTML = ''; // Clear previous content
            filePreview.appendChild(preElement);

            const applyButton = document.createElement('button');
            applyButton.textContent = 'Apply Changes';
            applyButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.APPLY_CHANGES, filePath: currentFilePath, newContent: message.newContent });
                filePreview.innerHTML = '<p>Changes applied. Ask for another change or read a new file.</p>';
                fileNameElement.textContent = '';
            };

            const discardButton = document.createElement('button');
            discardButton.textContent = 'Discard Changes';
            discardButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.DISCARD_CHANGES, filePath: currentFilePath });
                filePreview.innerHTML = '<p>Changes discarded. Ask for another change or read a new file.</p>';
                fileNameElement.textContent = '';
            };
            
            filePreview.appendChild(applyButton);
            filePreview.appendChild(discardButton);
        },
        [MESSAGE_COMMANDS.CHANGES_APPLIED]: (message) => {
            appendMessage('System', `Changes applied to ${message.filePath}`);
        },
        [MESSAGE_COMMANDS.CHANGES_DISCARDED]: (message) => {
            appendMessage('System', `Changes discarded for ${message.filePath}`);
        },
        [MESSAGE_COMMANDS.ERROR]: (message) => {
            appendMessage('Error', message.text, true);
        }
    };

    window.addEventListener('message', event => {
        const message = event.data;
        const handler = commandHandlers[message.command];
        if (handler) {
            handler(message);
        } else {
            console.warn('Unknown command received from extension:', message.command, message);
        }
    });

    function createMessageContentWithLinks(text) {
        const fragment = document.createDocumentFragment();
        const messageElement = document.createElement('div');

        // Naive link detection (http/https)
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        let lastIndex = 0;
        let match;
        while ((match = urlRegex.exec(text)) !== null) {
            // Append text before the link
            fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            // Create and append the link
            const link = document.createElement('a');
            link.href = match[0];
            link.textContent = match[0];
            link.target = '_blank'; // Open in new tab
            fragment.appendChild(link);
            lastIndex = urlRegex.lastIndex;
        }
        // Append remaining text after the last link (or the whole text if no links)
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
        return fragment;
    }

    function appendMessage(sender, text, isError = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        if (isError) {
            messageElement.classList.add('error-message');
        }
        
        const senderElement = document.createElement('strong');
        senderElement.textContent = sender + ': ';
        messageElement.appendChild(senderElement);
        
        const contentFragment = createMessageContentWithLinks(text);
        messageElement.appendChild(contentFragment);

        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
    }
});
