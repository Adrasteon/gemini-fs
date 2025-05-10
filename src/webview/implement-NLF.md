# Implementing NLF and Enhanced Accessibility for Gemini FS

This document outlines the core principles and detailed steps for enabling the Gemini FS extension to be controlled via Natural Language Functions (NLF) using voice input/output, and to provide enhanced accessibility options for users, particularly those with visual or motor impairments.

## Core Principles

1.  **Accessibility First:** The primary goal is to make coding and workspace interaction significantly more accessible to individuals who cannot easily use traditional keyboard/mouse/screen setups.
2.  **User Empowerment and Control:** Users must have clear control over how the NLF and accessibility features operate, including opting into potentially less restrictive confirmation flows.
3.  **Maintain Workspace Security:** All operations, regardless of input modality or confirmation level, must adhere to the established `secureResolvePath` logic, confining actions strictly to the user's active VS Code workspace.
4.  **Clear and Actionable Feedback:** The system must provide unambiguous feedback, both textually and audibly (via TTS), about its understanding of user intent, proposed actions, and executed operations.
5.  **Graceful Degradation:** If voice services or advanced NLF processing fails, the core chat and slash command functionality should remain operational.
6.  **Iterative Development:** These features will be complex; a phased approach with continuous user feedback (especially from the target user groups) is essential.

## Detailed Implementation Steps

### Phase 1: Foundational Voice I/O and NLF for Read-Only Operations

*   **Step 1.1: Integrate Basic Voice-to-Text (VTT) and Text-to-Voice (TTV) in Webview**
    *   **VTT:**
        *   In `src/webview/script.js`, add UI elements (e.g., a "Start/Stop Recording" button).
        *   Utilize the browser's Web Speech API (`SpeechRecognition`) for initial VTT.
        *   Transcribed text will be sent to the extension similar to typed messages, perhaps prefixed or flagged as a voice input.
    *   **TTV:**
        *   In `src/webview/script.js`, use the Web Speech API (`speechSynthesis`) to vocalize responses from Gemini or system messages.
        *   Add a setting to enable/disable automatic TTV for users who prefer only text.
    *   **Error Handling:** Implement basic error handling for VTT/TTV (e.g., "Could not understand audio," "Speech synthesis not available").

*   **Step 1.2: NLF Intent Parsing for Read Operations via Gemini**
    *   In `FileService.ts`, create a new handler (e.g., `handleNlfQuery`) or adapt `handleChatMessage`.
    *   If input is flagged as voice/NLF:
        *   Construct a prompt for `GeminiService` to parse intent. Example:
            ```
            "User NLF input: '[transcribed_text]'.
            Your task is to identify the primary action (e.g., 'read', 'list', 'find', 'open', 'describe') and any relevant parameters (e.g., file path, search term, entity name).
            Respond in a structured JSON format:
            {\"action\": \"ACTION_TYPE\", \"filePath\": \"[path_if_any]\", \"searchTerm\": \"[term_if_any]\", ...}
            If the intent is unclear, respond with {\"action\": \"clarify\", \"message\": \"Please rephrase or provide more details.\"}."
            ```
    *   `FileService` parses this JSON response.
    *   **Initial Focus:** Implement NLF for `/read <filePath>` and `/list <folderPath>` equivalents.
        *   "Gemini, read the package.json file."
        *   "What's in the source directory?"
    *   Responses are sent back to the webview (text and TTV).

*   **Step 1.3: Basic "Navigation" and "Information" NLF Commands**
    *   Extend NLF parsing for commands like:
        *   "Gemini, open `extension.ts`." (Uses `vscode.window.showTextDocument`).
        *   "Gemini, what files are currently open?"
        *   "Gemini, describe the `GeminiService` class in `geminiService.ts`." (Reads file, sends relevant section to Gemini for summarization).

### Phase 2: NLF for Write/Create/Delete with Enhanced & Accessible Confirmation

*   **Step 2.1: NLF Intent Parsing for Modifying Operations**
    *   Extend the Gemini intent parsing prompt (Step 1.2) to recognize "create," "write/modify," "delete," "rename," "add function," "change variable," etc., and extract necessary parameters (filePath, content description, modification instructions).

*   **Step 2.2: Accessible Confirmation Flow - Summarized Confirmation**
    *   For modifying operations triggered by NLF, before generating full code or showing a visual diff:
        1.  `FileService` receives parsed intent (e.g., "write to `config.js` to set debug_mode to true").
        2.  `FileService` prompts `GeminiService`:
            ```
            "User wants to: '[parsed_intent_details]'.
            Provide a concise, natural language summary of the *exact changes* you will make to the file(s) if you proceed.
            Example: 'I will modify config.js to change the value of debug_mode from false to true on line 15.'
            or 'I will create a new file named newFeature.ts and add a basic class structure.'
            Do NOT generate the code yet, only the summary."
            ```
        3.  This summary is sent to the webview (text and TTV).
        4.  Webview presents this summary with "Proceed" / "Explain More" / "Cancel" voice/click options.
            *   "Proceed": Moves to Step 2.3 or 2.4.
            *   "Explain More": `FileService` asks Gemini for a more detailed (but still NLF) explanation of the planned changes.
            *   "Cancel": Aborts the operation.

*   **Step 2.3: Code Generation and Standard Confirmation (Visual Diff)**
    *   If "Proceed" is chosen after summarized confirmation (and the user *hasn't* enabled a bypass):
        *   `FileService` prompts `GeminiService` to generate the actual code/content based on the confirmed summarized intent.
        *   The existing visual diff (`vscode.diff`) and webview preview (`showFilePreview`) mechanisms are used.
        *   Confirmation buttons in the webview ("Apply Changes," "Create File," "Confirm Delete") remain. These can also be voice-activated (e.g., "Gemini, apply the changes shown.").

*   **Step 2.4: Introduce User Settings for Accessibility Options**
    *   In `package.json` (contributes.configuration), add settings like:
        *   `geminiFS.accessibility.confirmationLevel`: (enum: "fullVisual", "summarizedVoice", "directWithGitCommit") - Default: "fullVisual".
        *   `geminiFS.accessibility.autoCommitChanges`: (boolean) - Default: `false`. (Controls Git commit for "directWithGitCommit" level).
        *   `geminiFS.accessibility.enableVoiceCommands`: (boolean) - Default: `true`.
        *   `geminiFS.accessibility.enableTextToSpeech`: (boolean) - Default: `true`.
    *   `FileService` and `GeminiService` will read these settings to adjust behavior.

### Phase 3: Advanced Accessibility Options & Safety Nets

*   **Step 3.1: Implement "Direct Action with Git Auto-Commit" Confirmation Level**
    *   If `geminiFS.accessibility.confirmationLevel` is set to `"directWithGitCommit"`:
        1.  After NLF intent parsing (Step 2.1) and potentially a *brief* summarized confirmation (Step 2.2, perhaps a very quick "Okay, I will now attempt to [action] on [file]."), the flow bypasses detailed visual diffs/previews.
        2.  **Git Auto-Commit (Crucial Prerequisite):**
            *   If `geminiFS.accessibility.autoCommitChanges` is `true`:
                *   The extension will need to execute Git commands. This might involve using a library like `simple-git` or directly spawning `git` processes.
                *   Before `FileService` calls `writeFile` or `delete`, it stages relevant changes and creates a commit.
                *   Commit message should be descriptive, e.g., "GeminiFS Auto-Commit: Applied NLF '[user_nlf_summary]' to [filePath]".
            *   If `autoCommitChanges` is `false` but `directWithGitCommit` is chosen, warn the user that this is less safe.
        3.  `FileService` directly performs the file operation (`writeFile`, `delete`).
        4.  Clear feedback (text and TTV) is provided: "Changes applied to `[filePath]` and committed." or "File `[filePath]` deleted."

*   **Step 3.2: Accessible Git Interaction Commands (NLF)**
    *   To complement auto-commits, provide NLF commands for basic recovery:
        *   "Gemini, what was the last change you committed?" (Reads commit message and affected files).
        *   "Gemini, undo your last committed change." (Executes `git revert HEAD` or similar, with a voice confirmation: "This will revert the commit: '[commit_message]'. Say 'confirm undo' or 'cancel'.").
        *   "Gemini, show me the changes in the last commit." (Could attempt to describe the diff in natural language or list changed lines).

*   **Step 3.3: ML-Based Feedback Loop for Prompt Refinement & Challenge (Advanced/Future)**
    *   **Data Collection (Opt-in & Anonymized):**
        *   Collect (with explicit user consent) NLF inputs, generated Gemini prompts, Gemini responses, and user confirmation/correction actions.
    *   **Model 1: Prompt Refinement:**
        *   Train a model to learn how to translate user NLF into more effective prompts for Gemini, aiming for higher accuracy in Gemini's output. This model suggests better prompts internally.
    *   **Model 2: Risk/Ambiguity Detection (Challenge Mechanism):**
        *   Train a model to identify NLF inputs that are:
            *   Highly ambiguous.
            *   Historically correlated with user corrections or discarded changes.
            *   Similar to known risky operations (e.g., broad deletions).
        *   If detected, the system "challenges" the user before proceeding:
            *   "That request seems a bit ambiguous. Could you clarify if you mean X or Y?"
            *   "Performing that action might have unintended side effects on [specific files/areas]. Would you like me to explain further before proceeding?"
    *   This ML loop aims to make the NLF interaction more robust and proactively safer.

### Phase 4: Iteration, Testing, and Community Feedback

*   **Usability Testing:** Crucially, involve users with visual and motor impairments throughout the development of these features. Their feedback will be invaluable.
*   **Refine VTT/TTV Quality:** Explore more advanced VTT/TTV libraries or services if browser APIs prove insufficient for a good user experience (consider API key management and potential costs).
*   **Expand NLF Vocabulary:** Continuously expand the range of NLF commands the system can understand and act upon.
*   **Documentation:** Provide clear documentation on how to use the NLF and accessibility features, including the implications of different confirmation levels.
*   **Error Recovery:** Enhance error messages and recovery options, especially for voice-only users.

### Key Files and Their Evolving Roles

*   **`src/extension.ts`:**
    *   Will register new settings for accessibility.
    *   May need to handle new messages from the webview related to voice commands or advanced confirmations.
*   **`src/fileService.ts`:**
    *   Major changes to `handleChatMessage` or new handlers for NLF.
    *   Logic to interact with `GeminiService` for NLF intent parsing and summarized explanations.
    *   Logic to check accessibility settings and adjust confirmation flows.
    *   Potential integration with a Git service/library for auto-commits and NLF Git commands.
    *   (Future) Integration point for the ML feedback loop model.
*   **`src/geminiService.ts`:**
    *   Will need new prompt templates for NLF intent parsing, summarization, and potentially for the ML feedback loop.
*   **`src/webview/main.html`:**
    *   New UI elements for voice input (e.g., microphone button).
    *   Potentially new areas for displaying summarized confirmations or more detailed NLF explanations.
*   **`src/webview/script.js`:**
    *   Implementation of VTT using Web Speech API (or other).
    *   Implementation of TTV using Web Speech API (or other).
    *   Handling new message types from the extension for summarized confirmations and NLF-driven UI updates.
    *   Logic to activate voice commands for webview buttons.
*   **(New) `src/gitService.ts` (Hypothetical):**
    *   If Git integration becomes complex, encapsulate Git operations (commit, revert, log) in a dedicated service.
*   **(New) `src/mlFeedbackService.ts` (Hypothetical, Future):**
    *   For managing data collection, training (if client-side aspects), and inference for the ML feedback loop.

This detailed plan aims to make Gemini FS Chat a significantly more inclusive and powerful tool, leveraging NLF and voice to open up coding to a wider audience while carefully considering safety and user experience.