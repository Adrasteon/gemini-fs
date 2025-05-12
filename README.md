// c:\Users\marti\gemini-fs\README.md
# Gemini FS Chat

Gemini FS Chat is a VS Code extension that allows you to interact with the Google Gemini AI models and perform file system operations within your workspace through a chat interface.

## Features

*   **Chat with Gemini:** Engage in conversations with Gemini models directly within VS Code.
*   **File System Interaction:** Use slash commands to read and (with confirmation) modify or create files within your project's root directory.
    *   `/read <filePath>`: Displays the content of a file in the chat. (Implemented and Tested)
    *   `/list [<folderPath>]`: Lists files and folders in the specified directory (defaults to workspace root). (Implemented and Tested)
    *   `/create <filePath> [description]`: Create new files.
        *   If a description is provided, Gemini will generate the initial content for the file.
        *   A preview of the Gemini-generated content is shown for confirmation before the file is created. (Implemented and Tested)
    *   `/write <filePath> <description>`: Modify existing files, with Gemini proposing changes based on your instructions.
        *   A webview preview displays a line-by-line diff of the proposed changes against the original content.
        *   User can confirm to apply changes or discard them. (Implemented and Tested)
    *   `/delete <filePath>`: Securely delete files and folders. (Framework in place, webview confirmation implemented, end-to-end flow under active development).
*   **Context Management for Chat:**
    *   `/context <filePath>`: Loads the content of the specified file into the chat context for subsequent Gemini queries.
    *   `/context <folderPath>`: Loads the content of all files (non-recursively) from the specified folder into the chat context.
    *   `/context list`: Displays the list of files currently loaded in the context.
    *   `/context clear`: Clears all files from the chat context.
*   **Secure Operations:** All file system interactions are carefully validated to ensure they occur within the boundaries of your open workspace and require explicit confirmation for any modifications or deletions.
*   **(Planned) Natural Language & Accessibility Features:**
    *   **Voice Control:** Interact with Gemini and the extension using voice commands (Voice-to-Text).
    *   **Spoken Feedback:** Receive responses and system messages audibly (Text-to-Speech).
    *   **Natural Language File Operations:** Perform file operations using conversational language (e.g., "Gemini, read my main configuration file," "add a new function to `utils.js` that sorts an array").
    *   **Accessible Confirmation Flows:** Options for users with visual or motor impairments, including summarized voice confirmations and direct actions with Git auto-commit as a safety net.
    *   **NLF-Powered Navigation & Information:** Open files, get information about your codebase, and more, using natural language.
    *   **(Future Vision) Intelligent Assistance:** An ML-driven feedback loop to refine prompt generation and provide proactive "challenge" responses for potentially ambiguous or risky NLF commands.

**Current Progress:**
*   Basic chat functionality with Gemini is implemented.
*   Core file reading (`/read`) and listing (`/list`) commands are fully functional and have unit tests.
*   The file creation command (`/create`) is fully functional, including Gemini content generation and webview confirmation, and has unit tests.
*   A robust Test-Driven Development (TDD) environment has been established for the `FileService`, with comprehensive unit tests for path resolution and core read/list/create operations.
*   The foundational framework for file writing (`/write`) and deletion (`/delete`) is in place. This includes:
    *   Parsing of these commands.
    *   Secure path resolution.
    *   Webview UI for displaying proposed content/changes and prompting for user confirmation (e.g., "Apply Changes", "Confirm Delete" buttons).
    *   Logic in `extension.ts` to receive these confirmations from the webview and call the appropriate `FileService` methods (`performConfirmedWrite`, `performConfirmedDelete`).
*   The `/write` command now features a webview-based diff display. Further refinement of Gemini prompts for complex modifications is ongoing.
*   Planning and initial design for Natural Language Functions (NLF), voice control, and enhanced accessibility features are ongoing.

## Requirements

*   VS Code version 1.85.0 or higher.
*   A Google AI Studio API key. You can obtain one from https://aistudio.google.com/app/apikey.
*   **(For planned voice features)** A microphone for voice input, and a browser/OS environment that supports the Web Speech API (for initial implementation).

## Extension Settings

*   `geminiFS.modelName`:  Specifies the Gemini model to use for chat interactions. Defaults to `gemini-1.5-flash-latest`. You can change this in VS Code settings (e.g., to `gemini-pro` if you have access).
*   **(Planned) `geminiFS.accessibility.confirmationLevel`**: Allows users to choose the confirmation method for file operations (e.g., full visual, summarized voice, direct action with Git commit).
*   **(Planned) `geminiFS.accessibility.autoCommitChanges`**: Enables/disables automatic Git commits before applying changes when using certain accessibility confirmation levels.
*   **(Planned) `geminiFS.accessibility.enableVoiceCommands`**: Toggles voice command input.
*   **(Planned) `geminiFS.accessibility.enableTextToSpeech`**: Toggles audible feedback.

## Commands Overview

| Command                     | Example Usage                            | Description                                                                                                                                                           |
| --------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (No command, just chat)     | `What is the capital of France?`         | Sends the message directly to Gemini for a general chat response.                                                                                                     |
| `/list`                     | `/list` or `/list src/components`        | Lists files and directories in the workspace root or specified path.                                                                                                |
| `/read <filePath>`          | `/read src/extension.ts`                 | Reads the specified file and displays its content in the chat.                                                                                                      |
| `/create <filePath> [desc]` | `/create new.txt a simple hello world`   | Asks Gemini to generate content for `new.txt` based on the description. Shows a preview. Upon confirmation, creates the file with the generated content.             |
| `/write <filePath> <desc>`  | `/write main.js add a console log`       | (Planned) Reads `main.js`, asks Gemini to modify it based on the description. Shows a preview/diff. Upon confirmation, applies the changes.                         |
| `/context <path>`           | `/context src/utils.ts`                  | Loads the content of `src/utils.ts` (or all files in a folder `src/utils`) into the chat context for subsequent Gemini queries.                                   |
| `/context list`             | `/context list`                          | Displays a list of all files currently loaded in the chat context.                                                                                                    |
| `/context clear`            | `/context clear`                         | Clears all files from the chat context.                                                                                                                               |
| `/delete <filePath>`        | `/delete old.log`                        | (Planned) Asks for confirmation before deleting `old.log`.                                                                                                          |

### Webview Interactions

The extension uses a webview panel for several interactions:

*   **API Key Input**: When the API key is not found, a prompt appears in the webview.
*   **File Previews/Confirmations**: For commands like `/create` (with Gemini-generated content), `/write` (with Gemini-proposed changes), and `/delete`, a preview or confirmation step is presented in the webview. You can then confirm or discard the proposed operation.

## Development

To run and debug the extension locally:

1.  Clone this repository.
2.  Open the folder in VS Code.
3.  Run `npm install` in the terminal to install dependencies.
4.  Press `F5` to open a new Extension Development Host window with the extension loaded.
5.  Use the "Gemini FS: Open Chat" command from the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`) to open the chat panel.

### Running Tests

1.  Ensure dependencies are installed (`npm install`).
2.  Run the "watch" task via the **Tasks: Run Task** command in VS Code (or `npm run watch` in the terminal). This compiles TypeScript in watch mode.
3.  Open the Testing view from the VS Code activity bar.
4.  Click the "Run Tests" button (play icon) at the top of the Testing view.
    *   Alternatively, use the hotkey `Ctrl+; A` (or `Cmd+; A` on Mac).
5.  Test results will appear in the "Test Results" output panel and within the Testing view.

## Roadmap / Future Development

The development of Gemini FS Chat is planned in phases:

*   **Phase 1: Core File System Read Operations & TDD Setup (Complete)**
    *   Implement `/read <filePath>` and `/list <folderPath>` with secure path resolution.
    *   Basic chat interface with Gemini.
    *   Establish a comprehensive TDD environment for `FileService`.
*   **Phase 2: File System Write/Create/Delete Operations with Confirmation (In Progress)**
    *   Implement `/create <filePath> [content_description]` allowing Gemini to generate content. (Complete and Tested).
    *   Implement `/write <filePath> <modification_description>` allowing Gemini to propose changes. (Webview confirmation flow complete, Gemini integration for content modification in progress).
    *   Develop robust webview UI for previewing proposed content/changes (including VS Code diff integration) and clear user confirmation buttons. (Basic preview in place, diff integration planned).
*   **Phase 3: Foundational NLF and Voice I/O (Planned)**
    *   Integrate basic Voice-to-Text (VTT) and Text-to-Speech (TTV) in the webview (initially using Web Speech API).
    *   Develop NLF intent parsing (via Gemini) for read-only operations (e.g., "read file X," "list directory Y," "open file Z," "describe class A").
*   **Phase 4: NLF for Modifying Operations with Accessible Confirmation (Planned)**
    *   Extend NLF intent parsing for create, write, and delete operations.
    *   Implement accessible confirmation flows:
        *   **Summarized Voice Confirmation:** Gemini provides a natural language summary of intended changes for voice approval before full code generation.
        *   User settings to select confirmation level.
*   **Phase 5: Advanced Accessibility Options & Safety Nets (Planned)**
    *   Implement "Direct Action with Git Auto-Commit" confirmation level (user-configurable).
        *   Integrate Git for automatic commits before applying NLF-triggered changes.
    *   Develop NLF commands for basic Git interactions (e.g., "undo last change," "show last commit").
*   **Phase 6: Intelligent NLF Assistance (Long-term Vision - Formerly Phase 7)**
    *   Explore an ML-based feedback loop (with user opt-in for data) to:
        *   Refine prompt generation from NLF to Gemini.
        *   Implement a "challenge" mechanism for ambiguous or potentially risky NLF commands.
*   **Ongoing Refinements:**
    *   Continuous improvement of error handling and user feedback.
    *   Enhanced webview UI/UX.
    *   Comprehensive testing, expanding unit and integration tests.
    *   Iterative prompt engineering for Gemini.
    *   Exploration of more advanced VTT/TTV libraries/services if Web Speech API proves insufficient.

## Known Issues
*   Error handling and user feedback can be further improved for edge cases.
*   While core `FileService` operations are unit tested, test coverage for webview interactions and end-to-end flows for `/write` and `/delete` is still to be expanded.
*   Initial NLF and voice features (when implemented) may have limitations in understanding complex commands or accents.

## Release Notes

Refer to the CHANGELOG.md for detailed release notes.

## Key Files and Their Evolving Roles

*   **`src/extension.ts`:**
    *   Manages extension activation, command registration, webview panel creation.
    *   `panel.webview.onDidReceiveMessage` will handle an expanded set of commands from the webview (e.g., `executeWrite`, `executeCreate`, `executeDelete`).
*   **`src/fileService.ts`:**
    *   Manages the main chat interaction loop, conversation history, and context state.
    *   Parses user commands and delegates file system-related command logic to `FileOperationCommands`.
    *   Orchestrates interactions between `GeminiService`, `FileOperationCommands`, and the webview for previews, confirmations, and feedback.
    *   Handles context management commands (`/context add, list, clear`).
*   **`src/fileOperationCommands.ts`:**
    *   Handles the specific logic for file system commands like `/read`, `/list`, `/create`, `/write`, and `/delete`.
    *   Interacts with `fileSystemUtils.ts` for low-level file operations and path resolution.
    *   Prepares data for webview previews and receives confirmed actions (e.g., `performConfirmedWrite`) to execute file changes.
*   **`src/fileSystemUtils.ts`:**
    *   Provides low-level, reusable utility functions for file system interactions (e.g., reading/writing file content using `vscode.workspace.fs`) and secure path resolution within the workspace. Used by `FileOperationCommands` and `FileService`.
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

## License

This project is licensed under the Apache License 2.0. See the LICENSE.md file for details.
