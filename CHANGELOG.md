// c:\Users\marti\gemini-fs\CHANGELOG.md
# Change Log

All notable changes to the "gemini-fs" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased] - YYYY-MM-DD 
*(Replace YYYY-MM-DD with the actual release date when ready)*

### Added
-   **Gemini Integration for `/create` command**:
    -   When using `/create <filePath> [description]`, Gemini is now used to generate the initial file content based on the provided description.
    -   A webview preview is shown with the Gemini-generated content, allowing the user to confirm or discard the creation.
    -   Comprehensive unit tests for the `/create` command flow, including Gemini interaction and webview preview.
-   Enhanced conversation history management for file operation commands, ensuring correct context is passed to Gemini and maintained.
-   Robust path normalization and security checks for file operations, including improved path comparison in mocks for cross-platform test stability.

### Fixed
-   Resolved test failures related to conversation history inspection for the `/create` command by ensuring the test stub captures the history state at the moment of the Gemini call.
-   Corrected mock for `vscode.workspace.fs.readFile` to return `Uint8Array` as expected by `FileService`, resolving `TypeError` during file reading in tests.
-   Improved path comparison logic in `fsMock.readDirectory` within tests to be case-insensitive on Windows, enhancing test reliability.

### Next Steps
- Complete Gemini integration for content modification in the `/write` command.
- Enhance webview UI for file previews/diffs, particularly for the `/write` command.
- Expand test coverage for the `/write` and `/delete` commands, including webview interactions and end-to-end file operations.
- Begin implementation of foundational NLF and Voice I/O (Phase 3).

## [0.0.1] - 2025-05-10 (Internal Development Milestone)

### Added
- Basic chat interface with Google Gemini models.
- `/read <filePath>` command to display file content in the chat.
