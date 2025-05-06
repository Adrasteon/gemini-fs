// @ts-ignore
const vscode = acquireVsCodeApi();
let currentFilePath = null;
let currentFileContent = null;

function requestApiKey() {
    vscode.postMessage({ command: 'getApiKey' });
}

document.addEventListener('DOMContentLoaded', () => {
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input');
    const chatMessages = document.getElementById('chat-messages');
    const filePreview = document.getElementById('file-preview');
    const fileNameElement = document.getElementById('file-name');

    // Request API key on load
    requestApiKey();

    sendButton.addEventListener('click', () => {
        const message = messageInput.value;
        if (message.trim() !== '') {
            appendMessage('You', message);
            vscode.postMessage({ command: 'sendToGemini', text: message });
            messageInput.value = '';
        }
    });

    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendButton.click();
        }
    });

    window.addEventListener('message', event => {
        const message = event.data;
        if (message.command === 'apiKey') {
            console.log("API Key received (or not) by webview:", message.key ? "Exists" : "Not set");
            // You might want to enable/disable UI elements based on API key presence
        }
        if (message.command === 'geminiResponse') {
            appendMessage('Gemini', message.text);
        } else if (message.command === 'fileContent') {
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
                span.textContent = line + '\n';
                codeElement.appendChild(span);
            });

            preElement.appendChild(codeElement);
            filePreview.innerHTML = ''; // Clear previous content
            filePreview.appendChild(preElement);

            const applyButton = document.createElement('button');
            applyButton.textContent = 'Apply Changes';
            applyButton.onclick = () => {
                vscode.postMessage({ command: 'applyChanges', filePath: currentFilePath, newContent: message.newContent });
                filePreview.innerHTML = '<p>Changes applied. Ask for another change or read a new file.</p>';
                fileNameElement.textContent = '';
            };

            const discardButton = document.createElement('button');
            discardButton.textContent = 'Discard Changes';
            discardButton.onclick = () => {
                vscode.postMessage({ command: 'discardChanges', filePath: currentFilePath });
                filePreview.innerHTML = '<p>Changes discarded. Ask for another change or read a new file.</p>';
                fileNameElement.textContent = '';
            };
            
            filePreview.appendChild(applyButton);
            filePreview.appendChild(discardButton);

        } else if (message.command === 'changesApplied') {
            appendMessage('System', `Changes applied to ${message.filePath}`);
        } else if (message.command === 'changesDiscarded') {
            appendMessage('System', `Changes discarded for ${message.filePath}`);
        } else if (message.command === 'error') {
            appendMessage('Error', message.text, true);
        }
    });

    function appendMessage(sender, text, isError = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        if (isError) {
            messageElement.classList.add('error-message');
        }
        
        const senderElement = document.createElement('strong');
        senderElement.textContent = sender + ': ';
        messageElement.appendChild(senderElement);
        
        // Naive link detection (http/https)
        const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
        let lastIndex = 0;
        let match;
        while ((match = urlRegex.exec(text)) !== null) {
            // Append text before the link
            messageElement.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
            // Create and append the link
            const link = document.createElement('a');
            link.href = match[0];
            link.textContent = match[0];
            link.target = '_blank'; // Open in new tab
            messageElement.appendChild(link);
            lastIndex = urlRegex.lastIndex;
        }
        // Append remaining text after the last link (or the whole text if no links)
        messageElement.appendChild(document.createTextNode(text.substring(lastIndex)));

        chatMessages.appendChild(messageElement);
        chatMessages.scrollTop = chatMessages.scrollHeight; // Scroll to bottom
    }
});
