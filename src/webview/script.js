// c:\Users\marti\gemini-fs\src\webview\script.js
// @ts-ignore
const vscode = acquireVsCodeApi();

// Attempt to import the diff library.
// If you are using esbuild to bundle webview.js, this import should work.
// Ensure 'diff' is listed in your package.json dependencies.
let diffLoadPromise = null;
let DiffModule = null; // To store the resolved diff module

function ensureDiffLibraryLoaded() {
    if (DiffModule) {
        return Promise.resolve(DiffModule);
    }
    if (!diffLoadPromise) {
        console.log("Attempting to dynamically load 'diff' library...");
        diffLoadPromise = import('diff').then(module => {
            DiffModule = module;
            console.log("Diff library loaded successfully.");
            return module;
        }).catch(error => {
            console.error("Failed to load 'diff' library:", error);
            appendMessage('System', 'Error: Diff library failed to load. File comparison will not be available.', true, true);
            throw error; // Re-throw so awaiters can catch it
        });
    }
    return diffLoadPromise;
}


// Global state for the current file being previewed, if any.
let activePreview = {
    filePath: null,
    action: null, // 'create', 'write', or 'delete'
    proposedContent: null, // For create/write
    originalContent: null // For write
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
    SHOW_FILE_PREVIEW_CREATE: 'showFilePreviewForCreate',
    SHOW_FILE_PREVIEW_WRITE: 'showFilePreviewForWrite',
    // Note: CONFIRM_DELETE is used for both directions.
    // Extension sends it to request webview to show delete UI.
    // Webview sends it back when user confirms deletion.
    // Consider renaming for clarity if this becomes confusing, e.g., REQUEST_DELETE_CONFIRMATION
    CHANGES_APPLIED: 'changesApplied',
    CHANGES_DISCARDED: 'changesDiscarded',
    ERROR: 'error',
    SYSTEM_MESSAGE: 'systemMessage', // General system messages
    HISTORY_UPDATE: 'historyUpdate', // For restoring chat history
};

function requestApiKey() {
    vscode.postMessage({ command: MESSAGE_COMMANDS.GET_API_KEY });
}

document.addEventListener('DOMContentLoaded', () => {
    const sendButton = document.getElementById('send-button');
    const messageInput = document.getElementById('message-input');
    const chatMessages = document.getElementById('chat-messages'); // Renamed from chat-container for consistency

    const filePreviewArea = document.getElementById('file-preview-area');
    const fileNameDisplayElement = document.getElementById('file-name-display');
    const filePreviewContentElement = document.getElementById('file-preview-content');

    // Defensive check for essential elements
    if (!sendButton || !messageInput || !chatMessages || !filePreviewArea || !fileNameDisplayElement || !filePreviewContentElement) {
        console.error('One or more essential UI elements are missing from the DOM.', {sendButton, messageInput, chatMessages, filePreviewArea, fileNameDisplayElement, filePreviewContentElement });
        if (chatMessages) { // Try to display an error in the chat if possible
            appendMessage('System', 'Critical UI Error: Some chat elements are missing. Please reload the webview.', true, true);
        }
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
        activePreview = { filePath: null, action: null, proposedContent: null, originalContent: null };
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
            // For example, if !message.key, disable messageInput and sendButton, and show a prompt.
        },
        [MESSAGE_COMMANDS.GEMINI_RESPONSE]: (message) => {
            appendMessage(message.sender || 'Gemini', message.text, message.isError);
        },
        [MESSAGE_COMMANDS.SYSTEM_MESSAGE]: (message) => {
            appendMessage('System', message.text, message.isError, true);
        },
        [MESSAGE_COMMANDS.HISTORY_UPDATE]: (message) => {
            if (chatMessages && message.history) {
                chatMessages.innerHTML = ''; // Clear existing messages
                message.history.forEach(msg => {
                    // Determine sender and text based on role and content structure
                    let sender = 'System';
                    let text = '';
                    let isError = false;
                    let isSystem = true;

                    if (msg.role === 'user') {
                        sender = 'You';
                        text = msg.parts[0].text;
                        isSystem = false;
                    } else if (msg.role === 'model') {
                        text = msg.parts[0].text;
                        if (text.startsWith('System: Error:')) {
                            sender = 'System';
                            text = text.substring('System: Error:'.length).trim();
                            isError = true;
                        } else if (text.startsWith('System:')) {
                            sender = 'System';
                            text = text.substring('System:'.length).trim();
                        } else {
                            sender = 'Gemini';
                            isSystem = false;
                        }
                    }
                    appendMessage(sender, text, isError, isSystem);
                });
            }
        },
        [MESSAGE_COMMANDS.SHOW_FILE_PREVIEW_CREATE]: (message) => {
            activePreview.filePath = message.filePath;
            activePreview.action = 'create';
            activePreview.proposedContent = message.proposedContent;
            activePreview.originalContent = null; // Not applicable for create

            fileNameDisplayElement.textContent = `Preview for new file: ${message.filePath}`;
            filePreviewContentElement.innerHTML = ''; // Clear previous content

            if (message.description) {
                const infoMessage = document.createElement('p');
                infoMessage.textContent = message.description;
                filePreviewContentElement.appendChild(infoMessage);
            }

            const preElement = document.createElement('pre');
            const codeElement = document.createElement('code');
            codeElement.textContent = message.proposedContent;
            preElement.appendChild(codeElement);
            filePreviewContentElement.appendChild(preElement);

            const actionButton = document.createElement('button');
            actionButton.textContent = 'Create File';
            actionButton.onclick = () => {
                vscode.postMessage({
                    command: MESSAGE_COMMANDS.CONFIRM_CREATE,
                    filePath: activePreview.filePath,
                    proposedContent: activePreview.proposedContent
                });
                clearAndHidePreview();
            };

            const discardButton = document.createElement('button');
            discardButton.textContent = 'Discard';
            discardButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.DISCARD_CHANGES, filePath: activePreview.filePath, action: 'create' });
                clearAndHidePreview();
            };

            filePreviewContentElement.appendChild(actionButton);
            filePreviewContentElement.appendChild(discardButton);
            showPreviewArea();
        },
        [MESSAGE_COMMANDS.SHOW_FILE_PREVIEW_WRITE]: async (message) => { // Make handler async
            let Diff; // Local variable for the diff module in this scope
            activePreview.filePath = message.filePath;
            activePreview.action = 'write';
            activePreview.proposedContent = message.proposedContent;
            activePreview.originalContent = message.originalContent;

            fileNameDisplayElement.textContent = `Preview changes for: ${message.filePath}`;
            filePreviewContentElement.innerHTML = ''; // Clear previous content

            if (message.description) {
                const infoMessage = document.createElement('p');
                infoMessage.textContent = message.description;
                filePreviewContentElement.appendChild(infoMessage);
            }

            try {
                Diff = await ensureDiffLibraryLoaded(); // Await the library
            } catch (error) {
                // Error is already logged and message appended by ensureDiffLibraryLoaded's catch block
                // Proceed to show fallback UI
            }

            if (!Diff || typeof Diff.diffLines !== 'function') {
                console.error('Diff library or diffLines function is not available even after attempting to load.');
                // Fallback message is likely already shown by ensureDiffLibraryLoaded, but double-check
                // Fallback: Show only proposed content or a more descriptive error in preview
                const errorMsgEl = document.createElement('p');
                errorMsgEl.className = 'error-message';
                errorMsgEl.textContent = 'Error: Diff library not available. Cannot show changes.';
                filePreviewContentElement.appendChild(errorMsgEl);

                const proposedTitle = document.createElement('p');
                proposedTitle.textContent = 'Proposed content:';
                filePreviewContentElement.appendChild(proposedTitle);

                const preProposed = document.createElement('pre');
                const codeProposed = document.createElement('code');
                codeProposed.textContent = escapeHtml(message.proposedContent || '');
                preProposed.appendChild(codeProposed);
                filePreviewContentElement.appendChild(preProposed);

            } else {
                const preElement = document.createElement('pre');
                const codeElement = document.createElement('code');

                // --- Diff Rendering Logic ---
                const diffResult = Diff.diffLines(message.originalContent || '', message.proposedContent || '', { newlineIsToken: true });
                const fragment = document.createDocumentFragment();
                diffResult.forEach((part) => {
                    const span = document.createElement('span');
                    span.className = part.added ? 'diff-added' : part.removed ? 'diff-removed' : 'diff-common';

                    let linePrefix = '  '; // For common lines
                    if (part.added) {
                        linePrefix = '+ ';
                    } else if (part.removed) {
                        linePrefix = '- ';
                    }

                    const lines = part.value.split('\n');
                    const isLastLineEmptyDueToTrailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
                    let processedText = lines
                        .slice(0, isLastLineEmptyDueToTrailingNewline ? lines.length - 1 : lines.length)
                        .map(line => `${linePrefix}${line}`)
                        .join('\n');
                    if (isLastLineEmptyDueToTrailingNewline) {
                        processedText += '\n';
                    }
                    span.textContent = processedText;
                    fragment.appendChild(span);
                });
                codeElement.appendChild(fragment);
                // --- End Diff Rendering Logic ---
                preElement.appendChild(codeElement);
                filePreviewContentElement.appendChild(preElement);
            }

            const actionButton = document.createElement('button');
            actionButton.textContent = (!Diff || typeof Diff.diffLines !== 'function') ? 'Apply Changes (Blindly)' : 'Apply Changes';
            actionButton.onclick = () => {
                vscode.postMessage({
                    command: MESSAGE_COMMANDS.CONFIRM_WRITE,
                    filePath: activePreview.filePath,
                    proposedContent: activePreview.proposedContent
                });
                clearAndHidePreview();
            };

            const discardButton = document.createElement('button');
            discardButton.textContent = 'Discard';
            discardButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.DISCARD_CHANGES, filePath: activePreview.filePath, action: 'write' });
                clearAndHidePreview();
            };

            filePreviewContentElement.appendChild(actionButton);
            filePreviewContentElement.appendChild(discardButton);
            showPreviewArea();
        },
        [MESSAGE_COMMANDS.CONFIRM_DELETE]: (message) => { // This handles the request from extension to show delete UI
            activePreview.filePath = message.filePath;
            activePreview.action = 'delete';
            activePreview.proposedContent = null;
            activePreview.originalContent = null;

            fileNameDisplayElement.textContent = `Confirm Deletion: ${message.filePath}`;
            filePreviewContentElement.innerHTML = '';

            const confirmMessageEl = document.createElement('p');
            confirmMessageEl.textContent = message.message || `Are you absolutely sure you want to delete ${message.filePath}? This action cannot be undone easily.`;
            confirmMessageEl.classList.add('warning-message');
            filePreviewContentElement.appendChild(confirmMessageEl);

            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Confirm Delete';
            deleteButton.classList.add('delete-button'); // For styling
            deleteButton.onclick = () => {
                // This sends the actual confirmation back to the extension
                vscode.postMessage({ command: MESSAGE_COMMANDS.CONFIRM_DELETE, filePath: activePreview.filePath });
                clearAndHidePreview();
            };

            const discardButton = document.createElement('button');
            discardButton.textContent = 'Cancel';
            discardButton.onclick = () => {
                vscode.postMessage({ command: MESSAGE_COMMANDS.DISCARD_CHANGES, filePath: activePreview.filePath, action: 'delete' });
                clearAndHidePreview();
            };

            filePreviewContentElement.appendChild(deleteButton);
            filePreviewContentElement.appendChild(discardButton);
            showPreviewArea();
        },
        [MESSAGE_COMMANDS.CHANGES_APPLIED]: (message) => {
            appendMessage('System', `Changes applied to ${message.filePath}`, false, true);
        },
        [MESSAGE_COMMANDS.CHANGES_DISCARDED]: (message) => {
            appendMessage('System', `Action discarded for ${message.filePath}.`, false, true);
        },
        [MESSAGE_COMMANDS.ERROR]: (message) => { // General error from extension
            appendMessage('System', `Error: ${message.text}`, true, true);
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

    // Attempt to preload the diff library when the DOM is ready, but don't block anything.
    // Errors during this initial load attempt will be caught and logged by ensureDiffLibraryLoaded.
    ensureDiffLibraryLoaded().catch(() => { /* Errors handled internally */ });


    function createMessageContentWithLinks(text = "") {
        const fragment = document.createDocumentFragment();
        const searchText = String(text);

        const combinedRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])|```([\s\S]*?)```|`([^`]+?)`/ig;

        let lastIndex = 0;
        let match;

        while ((match = combinedRegex.exec(searchText)) !== null) {
            if (match.index > lastIndex) {
                fragment.appendChild(document.createTextNode(searchText.substring(lastIndex, match.index)));
            }

            if (match[1]) { // URL
                const link = document.createElement('a');
                link.href = match[1];
                link.textContent = match[1];
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                fragment.appendChild(link);
            } else if (match[3] !== undefined) { // Block code ```...```
                const pre = document.createElement('pre');
                const code = document.createElement('code');
                // Remove potential language hint from the start of the block for display
                let content = match[3];
                const firstNewline = content.indexOf('\n');
                if (firstNewline === 0) { // ```\ncode...
                    content = content.substring(1);
                } else if (firstNewline > 0 && content.substring(0, firstNewline).trim().match(/^[a-zA-Z0-9]+$/)) {
                     // ```lang\ncode... -> remove lang
                    content = content.substring(firstNewline + 1);
                }
                code.textContent = content;
                pre.appendChild(code);
                fragment.appendChild(pre);
            } else if (match[4] !== undefined) { // Inline code `...`
                const code = document.createElement('code');
                code.textContent = match[4];
                // Optionally wrap inline code in a <span> or apply class for styling
                const span = document.createElement('span');
                span.classList.add('inline-code'); // Add a class for styling
                span.appendChild(code);
                fragment.appendChild(span);
            }
            lastIndex = combinedRegex.lastIndex;
        }
        if (lastIndex < searchText.length) {
            fragment.appendChild(document.createTextNode(searchText.substring(lastIndex)));
        }
        return fragment;
    }


    function appendMessage(sender, text, isError = false, isSystem = false) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');

        if (isError) {
            messageElement.classList.add('error-message');
        } else if (isSystem) {
            messageElement.classList.add('system-message');
        } else {
            // Sanitize sender name for CSS class
            const senderClass = sender.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
            messageElement.classList.add(`${senderClass}-message`);
        }


        const senderElement = document.createElement('strong');
        senderElement.textContent = sender + ': ';
        messageElement.appendChild(senderElement);

        const contentFragment = createMessageContentWithLinks(text);
        messageElement.appendChild(contentFragment);

        if (chatMessages) {
            chatMessages.appendChild(messageElement);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        } else {
            console.error("chatMessages element not found, cannot append message:", sender, text);
        }
    }

    // Helper function to escape HTML for safe rendering in pre/code tags if not using textContent
    function escapeHtml(unsafe) {
        if (typeof unsafe !== 'string') {return '';}
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }
});
