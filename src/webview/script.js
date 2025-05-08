// @ts-ignore
const vscode = acquireVsCodeApi();
// Global state for the current file being previewed, if any.
let activePreview = {
    filePath: null,
    action: null, // 'create', 'write', or 'delete'
    proposedContent: null // For create/write
};

// Define constants for message commands to improve maintainability and reduce typos
const MESSAGE_COMMANDS = {
    // Webview to Extension
    GET_API_KEY: 'getApiKey',
    SEND_TO_GEMINI: 'sendToGemini',
    CONFIRM_CREATE: 'confirmCreate',
    CONFIRM_WRITE: 'confirmWrite',
    CONFIRM_DELETE: 'confirmDelete',
    DISCARD_CHANGES: 'discardChanges', // User discards a preview/confirmation

    // Extension to Webview
    API_KEY: 'apiKey',
    GEMINI_RESPONSE: 'geminiResponse',
    SHOW_FILE_PREVIEW: 'showFilePreview', // For create/write previews
    CONFIRM_DELETE_PROMPT: 'confirmDeletePrompt', // For delete confirmation
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

    const filePreviewArea = document.getElementById('file-preview-area');
    const fileNameDisplayElement = document.getElementById('file-name-display');
    const filePreviewContentElement = document.getElementById('file-preview-content');

    // Defensive check for essential elements
    if (!sendButton || !messageInput || !chatMessages || !filePreviewArea || !fileNameDisplayElement || !filePreviewContentElement) {
        console.error('One or more essential UI elements are missing from the DOM.', {sendButton, messageInput, chatMessages, filePreviewArea, fileNameDisplayElement, filePreviewContentElement });
        // Optionally, display an error message in the webview UI
        return;
    }

    // Request API key on load
    requestApiKey();

    sendButton.addEventListener('click', () => {
        const message = messageInput.value;
        if (message.trim() !== '') {
            appendMessage('You', message);
            vscode.postMessage({ command: MESSAGE_COMMANDS.SEND_TO_GEMINI, text: message });
            messageInput.value = '';
        }
    });

    messageInput.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendButton.click();
        }
    });

    function clearAndHidePreview() {
        filePreviewContentElement.innerHTML = '';
        fileNameDisplayElement.textContent = '';
        filePreviewArea.classList.add('hidden');
        activePreview = { filePath: null, action: null, proposedContent: null };
    }

    function showPreviewArea() {
        filePreviewArea.classList.remove('hidden');
        // Scroll the preview area into view if it's long
        filePreviewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }


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
        [MESSAGE_COMMANDS.SHOW_FILE_PREVIEW]: (message) => {
            activePreview.filePath = message.filePath;
            activePreview.action = message.action; // 'create' or 'write'
            activePreview.proposedContent = message.proposedContent;

            fileNameDisplayElement.textContent = `File: ${message.filePath}`;
            filePreviewContentElement.innerHTML = ''; // Clear previous content

            if (message.message) {
                const infoMessage = document.createElement('p');
                infoMessage.textContent = message.message;
                filePreviewContentElement.appendChild(infoMessage);
            }

            const preElement = document.createElement('pre');
            const codeElement = document.createElement('code');

            if (message.action === 'write' && message.originalContent) {
                // Basic diff rendering (can be improved with a proper diff library)
                // For simplicity, just showing proposed content for now.
                // A real diff would compare message.originalContent and message.proposedContent
                const diffHeader = document.createElement('h4');
                diffHeader.textContent = 'Proposed Changes:';
                filePreviewContentElement.appendChild(diffHeader);
                codeElement.textContent = message.proposedContent;
            } else { // For 'create' or 'write' without original content for diff
                codeElement.textContent = message.proposedContent;
            }
            preElement.appendChild(codeElement);
            filePreviewContentElement.appendChild(preElement);

            const actionButton = document.createElement('button');
            if (message.action === 'create') {
                actionButton.textContent = 'Create File';
                actionButton.onclick = () => {
                    vscode.postMessage({
                        command: MESSAGE_COMMANDS.CONFIRM_CREATE,
                        filePath: activePreview.filePath,
                        proposedContent: activePreview.proposedContent
                    });
                    clearAndHidePreview();
                };
            } else { // 'write'
                actionButton.textContent = 'Apply Changes';
                actionButton.onclick = () => {
                    vscode.postMessage({
                        command: MESSAGE_COMMANDS.CONFIRM_WRITE,
                        filePath: activePreview.filePath,
                        proposedContent: activePreview.proposedContent
                    });
                    clearAndHidePreview();
                };
            }

            const discardButton = document.createElement('button');
            discardButton.textContent = 'Discard';
            discardButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.DISCARD_CHANGES, filePath: activePreview.filePath });
                clearAndHidePreview();
            };

            filePreviewContentElement.appendChild(actionButton);
            filePreviewContentElement.appendChild(discardButton);
            showPreviewArea();
        },
        [MESSAGE_COMMANDS.CONFIRM_DELETE_PROMPT]: (message) => {
            activePreview.filePath = message.filePath;
            activePreview.action = 'delete';

            fileNameDisplayElement.textContent = `Confirm Deletion: ${message.filePath}`;
            filePreviewContentElement.innerHTML = ''; // Clear previous content

            const confirmMessage = document.createElement('p');
            confirmMessage.textContent = message.message;
            confirmMessage.classList.add('warning-message'); // Add a class for styling if needed
            filePreviewContentElement.appendChild(confirmMessage);

            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Confirm Delete';
            deleteButton.classList.add('delete-button'); // Add a class for styling
            deleteButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.CONFIRM_DELETE, filePath: activePreview.filePath });
                clearAndHidePreview();
            };

            const discardButton = document.createElement('button');
            discardButton.textContent = 'Cancel';
            discardButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.DISCARD_CHANGES, filePath: activePreview.filePath });
                clearAndHidePreview();
            };

            filePreviewContentElement.appendChild(deleteButton);
            filePreviewContentElement.appendChild(discardButton);
            showPreviewArea();
        },
        [MESSAGE_COMMANDS.CHANGES_APPLIED]: (message) => {
            appendMessage('System', `Changes applied to ${message.filePath}`);
        },
        [MESSAGE_COMMANDS.CHANGES_DISCARDED]: (message) => {
            appendMessage('System', `Action discarded for ${message.filePath}.`);
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

    function createMessageContentWithLinks(text = "") { // Add default value for text
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

    function appendMessage(sender, text, isError = false, senderType = 'user') { // senderType can be 'user', 'gemini', 'system'
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        if (isError) {
            messageElement.classList.add('error-message');
        } else {
            messageElement.classList.add(sender.toLowerCase()); // e.g., 'user', 'gemini', 'system'
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
