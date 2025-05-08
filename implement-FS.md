// gemini-fs\implement-FS.md
# Implementing File System Interaction for Gemini FS Extension

This document outlines the core principles and detailed steps for enabling the Gemini FS extension to allow Gemini to read and write files within the user's project workspace, under strict user authorization.

## Core Principles

1.  **User Authorization is Paramount:** Gemini should *never* perform file operations (read, write, create, delete) without explicit user instruction. For destructive operations (write, create, delete), explicit user confirmation is mandatory.
2.  **Clear Commands & Intent:** The user needs a clear way to instruct Gemini. This can be achieved through:
    *   **Specific Slash Commands:** (e.g., `/read path/to/file.txt`, `/write path/to/file.txt <content>`). These are easier to parse initially.
    *   **Natural Language Understanding (Advanced):** Allowing more conversational commands (e.g., "Gemini, read `package.json`"). This would involve Gemini parsing the intent.
3.  **Workspace-Scoped Operations:** All file operations must be strictly confined within the currently open VS Code workspace root. Access outside this boundary must be prevented.
4.  **Feedback and Confirmation:**
    *   **Reading:** Display content or a summary in the chat.
    *   **Writing/Creating:** Show a diff of changes or proposed new content. Always require user confirmation (e.g., an "Apply" button).
    *   **Deleting:** Present a clear confirmation prompt before any deletion.
5.  **Leverage VS Code APIs:** Utilize `vscode.workspace.fs` for all file system interactions due to its asynchronous nature and integration with VS Code's file handling.

## Detailed Implementation Steps

### Phase 1: Understanding User Intent and Basic Read Operations

*   **Step 1.1: Enhance Command Parsing in `FileService.handleChatMessage`**
    *   Expand beyond the current `/read` command to recognize other commands or prepare messages for Gemini to parse intent.
    *   **Initial Approach (Simpler):**
        *   Detect slash commands like `/read <path>`, `/list <path>`.
        *   Extract the `<path>` argument.
    *   **Advanced Approach (Consider for later):**
        *   If no direct slash command is found, send the user's full message to Gemini with a specific instruction to parse the intent, path, and content, returning a structured JSON.
        *   Example prompt for Gemini: "Your task is to analyze the following user request and extract the intended file operation (e.g., 'read', 'write', 'create', 'list', 'delete'), the target file/folder path (relative to the project root), and any content the user wants to write or a description of content to be generated. Respond in a structured JSON format: `{\"action\": \"ACTION_TYPE\", \"path\": \"FILE_PATH\", \"content_description\": \"USER_CONTENT_OR_DESCRIPTION\"}`."
        *   `FileService` would then parse this JSON response from Gemini.

*   **Step 1.2: Implement Path Resolution and Security**
    *   In `FileService`, before any file operation, resolve the user-provided path (relative to workspace root) to an absolute `vscode.Uri`.
    *   **Crucial Security Check:** Ensure the resolved absolute path is *within* `vscode.workspace.workspaceFolders[0].uri.fsPath`. If not, deny the operation and inform the user.
        ```typescript
        // Example snippet for FileService
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            // Handle error: no workspace open
            return;
        }
        const rootUri = workspaceFolder.uri;
        let targetUri: vscode.Uri;
        try {
            targetUri = vscode.Uri.joinPath(rootUri, path.normalize(relativePathFromUser));
        } catch (e) {
            // Handle invalid path
            return;
        }

        if (!targetUri.fsPath.startsWith(rootUri.fsPath)) {
            // Handle error: path outside workspace
            return;
        }
        // 'targetUri' is now safe to use
        ```

*   **Step 1.3: Implement `/list <folderPath>` Functionality**
    *   Add a new method in `FileService`, e.g., `async listDirectory(dirUri: vscode.Uri, webview: vscode.Webview)`.
    *   Use `await vscode.workspace.fs.readDirectory(dirUri)` which returns `[fileName, fileType][]`.
    *   Format this list (e.g., distinguishing files and folders) and send it to the webview via `webview.postMessage({ command: 'geminiResponse', sender: 'system', text: formattedList });`.
    *   Update `handleChatMessage` to call this method when a `/list` command is detected.

*   **Step 1.4: Refine `/read <filePath>`**
    *   Ensure it uses the secure path resolution (Step 1.2).
    *   Consider limits for very large files (send a snippet or ask for confirmation).
    *   The read content should be added to `currentHistory` for Gemini, allowing follow-up questions.

### Phase 2: Implementing Create and Write Operations with Confirmation

*   **Step 2.1: Define Webview Interaction for Write/Create**
    *   The webview needs to display proposed content/changes and provide "Apply"/"Create" and "Discard"/"Cancel" buttons.
    *   Utilize the `file-preview-area` in `src/webview/main.html`.
    *   In `src/webview/script.js`:
        *   Add new message handlers (e.g., for `showFilePreviewForCreate`, `showFilePreviewForWrite`).
        *   These handlers will populate `file-preview-area` with proposed content and action buttons.
        *   Button clicks will `vscode.postMessage` back to the extension (e.g., `executeCreate`, `executeWrite`) with `filePath` and `newContent`.

*   **Step 2.2: Implement File Creation (`/create <filePath> [content]` or Gemini generates content)**
    1.  **Intent & Path:** `FileService.handleChatMessage` determines "create" and gets `filePath`.
    2.  **Get Content:**
        *   Directly from user command if provided.
        *   Or, prompt `GeminiService` to generate content based on user request.
    3.  **Show Preview & Get Confirmation:**
        *   `FileService` sends `webview.postMessage({ command: 'showFilePreviewForCreate', filePath: '...', proposedContent: '...' });`.
        *   Webview displays content and "Create File" / "Cancel" buttons.
    4.  **Execute Creation:**
        *   On "Create File" click, webview sends `vscode.postMessage({ command: 'executeCreate', filePath: '...', newContent: '...' });`.
        *   `FileService` (or a dedicated handler) receives this and calls `await this.writeFile(targetUri, newContent);`.
        *   Send success/failure message back to webview.

*   **Step 2.3: Implement File Writing/Modification (`/write <filePath> [content]` or Gemini suggests changes)**
    1.  **Intent & Path:** `FileService.handleChatMessage` determines "write" and gets `filePath`.
    2.  **Get Original Content:** `FileService` reads current content using `this.readFile(targetUri)`.
    3.  **Get Proposed Content:**
        *   Directly from user command.
        *   Or, prompt `GeminiService`: "Current content of `filePath` is: `originalContent`. User wants to: `userModificationRequest`. Provide complete new content."
    4.  **Show Diff & Get Confirmation:**
        *   **Option A (VS Code Diff View - Recommended for complex changes):**
            *   `FileService` creates a temporary file with `proposedContent`.
            *   `await vscode.commands.executeCommand('vscode.diff', originalFileUri, proposedTempFileUri, 'Review Changes: ' + filePath);`.
            *   Webview informs user to review in diff tab and confirm via chat (e.g., "Type 'apply changes' or 'discard changes'").
        *   **Option B (Webview Diff/Preview - Simpler changes):**
            *   `FileService` sends `webview.postMessage({ command: 'showFilePreviewForWrite', filePath: '...', originalContent: '...', proposedContent: '...' });`.
            *   `src/webview/script.js` renders a basic diff or full proposed content with "Apply Changes" / "Discard Changes" buttons.
    5.  **Execute Write:**
        *   If confirmed (via chat or webview button), `FileService` calls `await this.writeFile(targetUri, newContent);`.
        *   Send success/failure message.

### Phase 3: Implementing Deletion with Extreme Caution

*   **Step 3.1: Implement `/delete <filePath>`**
    1.  **Intent & Path:** `FileService.handleChatMessage` determines "delete" and gets `filePath`.
    2.  **Explicit Confirmation (Non-negotiable):**
        *   `FileService` sends `webview.postMessage({ command: 'confirmDelete', filePath: '...' });`.
        *   Webview displays a clear warning: "Are you absolutely sure you want to delete `filePath`? This action cannot be undone easily." with "Confirm Delete" and "Cancel" buttons.
    3.  **Execute Deletion:**
        *   On "Confirm Delete" click, webview sends `vscode.postMessage({ command: 'executeDelete', filePath: '...' });`.
        *   `FileService` calls `await vscode.workspace.fs.delete(targetUri, { recursive: true });` (use `recursive: true` for non-empty folders with even stronger warnings).
        *   Send success/failure message.

### Phase 4: Iteration and Refinement

*   **Error Handling:** Ensure user-friendly error messages in the webview.
*   **Gemini Prompt Engineering:** Iteratively improve prompts for intent parsing and content generation.
*   **Webview UI/UX:** Enhance the webview for clear display of previews, diffs, and confirmations.
*   **Context Management:**
    *   Include relevant file content/paths in the history sent to Gemini for related operations.
    *   Be mindful of context window limits; summarize or truncate large file contents when adding to history.
*   **Security Hardening:** Continuously review path validation and user confirmation flows.

### Key Files and Their Evolving Roles

*   **`src/extension.ts`:**
    *   Manages extension activation, command registration, webview panel creation.
    *   `panel.webview.onDidReceiveMessage` will handle an expanded set of commands from the webview (e.g., `executeWrite`, `executeCreate`, `executeDelete`).
*   **`src/fileService.ts`:**
    *   Central hub for parsing user commands (directly or via Gemini).
    *   Securely resolving paths within the workspace.
    *   Interacting with `vscode.workspace.fs` for all file operations.
    *   Orchestrating content generation/retrieval with `GeminiService` or user input.
    *   Sending data/previews to the webview for user confirmation.
    *   Receiving and acting upon user confirmations from the webview.
*   **`src/geminiService.ts`:**
    *   Called by `FileService` for:
        *   General chat.
        *   Parsing user intent for file operations (if using the advanced NLU approach).
        *   Generating new file content.
        *   Suggesting modifications to existing file content.
*   **`src/webview/main.html`:**
    *   Will require new sections or dynamic elements for displaying file previews, diffs (if not using native VS Code diff), and various confirmation buttons/dialogs.
*   **`src/webview/script.js`:**
    *   Will need new `MESSAGE_COMMANDS` for the expanded interactions.
    *   New `commandHandlers` to display previews, confirmation prompts, and manage associated UI elements (buttons, text areas for content).
    *   Logic in button event listeners to `vscode.postMessage` user decisions (apply, discard, create, delete) back to the extension.

This detailed plan should provide a solid foundation for implementing robust and secure file system interaction capabilities in your Gemini FS extension. Remember to approach this incrementally, testing each piece thoroughly.
