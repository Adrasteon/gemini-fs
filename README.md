# Gemini FS Chat

Gemini FS Chat is a VS Code extension that allows you to interact with the Google Gemini AI models and perform file system operations within your workspace through a chat interface.

## Features

*   **Chat with Gemini:** Engage in conversations with Gemini models directly within VS Code.
*   **File System Interaction:**  Use slash commands to read and (with confirmation) modify or create files within your project's root directory.
    *   `/read <filePath>`: Displays the content of a file in the chat.
    *   `/list [<folderPath>]`: Lists the files and folders in the specified directory (defaults to workspace root).
    *   `/create <filePath> [description of content for Gemini to generate]`: Creates a new file (if it doesn't exist) at the given path. If a description is provided, Gemini will generate content for the file based on that description. Otherwise, an empty file is created.
    *   `/write <filePath> <description of changes for Gemini>`: Modifies the content of an existing file. You provide a description of the changes you want, and Gemini proposes a new file content based on that.  A preview of the changes (or a full replacement of content for new files) is displayed for your review and confirmation.
    *   `/delete <filePath>`:  Deletes a file or folder. Requires explicit user confirmation in the webview.
*   **Secure Operations:** All file system interactions are carefully validated to ensure they occur within the boundaries of your open workspace and require explicit confirmation for any modifications or deletions.

**Current Progress:**
*   Basic chat functionality with Gemini is implemented.
*   File reading (`/read`) and listing (`/list`) commands are functional.
*   The framework for file creation (`/create`), writing (`/write`), and deletion (`/delete`) is set up, including user confirmation prompts in the webview, but full logic and UI for diffs/previews are still under development.

## Requirements

*   VS Code version 1.85.0 or higher.
*   A Google AI Studio API key. You can obtain one from [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey).

## Extension Settings

*   `geminiFS.modelName`:  Specifies the Gemini model to use for chat interactions. Defaults to `gemini-1.5-flash-latest`. You can change this in VS Code settings (e.g., to `gemini-pro` if you have access).

## Known Issues

*   The UI for previewing file modifications and displaying diffs is basic and may lack advanced features like syntax highlighting.
*   Error handling and user feedback may be inconsistent in some scenarios.
*   Testing coverage is still limited.

## Release Notes

### 0.0.1
Initial pre-release version. Features a basic chat interface with Gemini and supports file reading and listing. Implements a framework for file creation, modification, and deletion, including user confirmation, but UI for previews/diffs is still rudimentary.
