// c:\Users\marti\gemini-fs\src\fileService.ts
import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { GeminiService } from './geminiService'; // Import GeminiService
import { Content } from '@google/generative-ai'; // Import Content type

/**
 * Service class for handling file system operations within the VS Code workspace.
 */
export class FileService {
    private context: vscode.ExtensionContext;
    private geminiService: GeminiService;
    private conversationHistory: Map<string, Content[]> = new Map(); // To store history per webview session (if needed, or global)

    constructor(context: vscode.ExtensionContext, geminiService: GeminiService) {
        this.context = context;
        this.geminiService = geminiService;
        console.log("FileService instantiated with context and geminiService.");
    }

    /**
     * Reads the content of a file specified by its URI.
     * @param fileUri The URI of the file to read.
     * @returns The content of the file as a string.
     * @throws An error if the file cannot be read or other unexpected errors occur.
     */
    public async readFile(fileUri: vscode.Uri): Promise<string> {
        try {
            const readData = await vscode.workspace.fs.readFile(fileUri);
            const fileContent = Buffer.from(readData).toString('utf8');
            return fileContent;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error reading file ${fileUri.fsPath}:`, error);

            // Check for specific file system errors if needed
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                vscode.window.showWarningMessage(`File not found: ${fileUri.fsPath}`);
            } else {
                vscode.window.showErrorMessage(`Failed to read file: ${fileUri.fsPath}. ${errorMessage}`);
            }
            throw error; // Re-throw to allow caller to handle
        }
    }

    /**
     * Writes content to a file specified by its URI. Creates the file if it doesn't exist.
     * @param fileUri The URI of the file to write to.
     * @param content The content to write to the file.
     * @param options Optional configuration for writing.
     * @param options.showUserMessages Control whether user-facing messages are shown on success/error (defaults to true).
     * @throws An error if the file cannot be written.
     */
    public async writeFile(
        fileUri: vscode.Uri,
        content: string,
        options: { showUserMessages?: boolean } = { showUserMessages: true }
    ): Promise<void> {
        try {
            const writeData = Buffer.from(content, 'utf8');
            await vscode.workspace.fs.writeFile(fileUri, writeData);
            if (options.showUserMessages) {
                console.log(`Successfully wrote to ${fileUri.fsPath}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error writing file ${fileUri.fsPath}:`, error);
            if (options.showUserMessages) {
                vscode.window.showErrorMessage(`Failed to write file: ${fileUri.fsPath}. ${errorMessage}`);
            }
            throw error; // Re-throw
        }
    }

    /**
     * Creates a temporary file with the given content.
     * Useful for showing diffs against proposed changes.
     * Handles its own errors internally without necessarily showing user messages.
     * @param content The content for the temporary file.
     * @param prefix A prefix for the temporary file name (optional).
     * @returns The URI of the created temporary file.
     * @throws An error if the temporary file cannot be created/written.
     */
    private async createTemporaryFile(content: string, prefix: string = 'gemini-diff-'): Promise<vscode.Uri> {
        const tempDir = os.tmpdir();
        const tempFileName = `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 8)}.tmp`;
        const tempFilePath = path.join(tempDir, tempFileName);
        const tempFileUri = vscode.Uri.file(tempFilePath);

        await this.writeFile(tempFileUri, content, { showUserMessages: false });
        return tempFileUri;
    }

    /**
     * Shows a diff view between the original content (from a file URI) and the proposed content.
     * @param originalFileUri The URI of the original file.
     * @param proposedContent The proposed new content as a string.
     * @param title Optional title for the diff view tab.
     */
    public async showDiff(originalFileUri: vscode.Uri, proposedContent: string, title?: string): Promise<void> {
        try {
            const proposedTempUri = await this.createTemporaryFile(proposedContent, `proposed-${path.basename(originalFileUri.fsPath)}-`);
            const diffTitle = title || `Diff: ${path.basename(originalFileUri.fsPath)}`;
            await vscode.commands.executeCommand('vscode.diff', originalFileUri, proposedTempUri, diffTitle);
            // Note: Temporary file cleanup is still omitted for simplicity.
            // Consider deleting proposedTempUri.fsPath after the diff view is closed or no longer needed.
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error showing diff for ${originalFileUri.fsPath}:`, error);
            vscode.window.showErrorMessage(`Failed to show diff: ${errorMessage}`);
        }
    }

    /**
     * Handles a chat message from the webview, potentially interacting with Gemini
     * and the file system.
     * @param messageText The text of the message from the user.
     * @param webview The webview panel to post messages back to.
     */
    public async handleChatMessage(messageText: string, webview: vscode.Webview): Promise<void> {
        console.log(`FileService.handleChatMessage received: "${messageText}"`);
        const historyKey = 'globalChat';
        let currentHistory = this.conversationHistory.get(historyKey) || [];

        try {
            // Add user's message to history BEFORE any processing
            currentHistory.push({ role: "user", parts: [{ text: messageText }] });

            if (messageText.toLowerCase().startsWith('/read ')) {
                const filePath = messageText.substring(6).trim();
                if (!filePath) {
                    const errorMsg = "Please specify a file path after /read.";
                    webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: errorMsg });
                    currentHistory.push({ role: "model", parts: [{ text: `Error: ${errorMsg}` }] }); // Log error to history
                    this.conversationHistory.set(historyKey, currentHistory);
                    return;
                }

                let workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    workspaceFolders = [];
                }
                if (workspaceFolders.length === 0) {
                   const errorMsg = "No workspace folder open to read files from.";
                   webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: errorMsg });
                   currentHistory.push({ role: "model", parts: [{ text: `Error: ${errorMsg}` }] }); // Log error to history
                   this.conversationHistory.set(historyKey, currentHistory);
                   return;
                }
                const rootUri = workspaceFolders[0].uri;
                const fileUri = vscode.Uri.joinPath(rootUri, filePath);

                try {
                    const fileContent = await this.readFile(fileUri);
                    const responseText = `Content of ${filePath}:\n${fileContent.substring(0, 500)}${fileContent.length > 500 ? '...' : ''}`;
                    webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: responseText });
                    currentHistory.push({ role: "model", parts: [{ text: responseText }] }); // Log successful read to history
                } catch (readError) {
                    const errorMsg = `Failed to read file ${filePath}: ${readError instanceof Error ? readError.message : String(readError)}`;
                    webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: errorMsg });
                    currentHistory.push({ role: "model", parts: [{ text: `Error: ${errorMsg}` }] }); // Log read error to history
                }
            } else {
                // General query to Gemini
                console.log("FileService: Attempting to process general query with Gemini.");
                try {
                    console.log("FileService: PRE-CALL to geminiService.askGeminiWithHistory. History length:", currentHistory.length, "Current history being sent:", JSON.stringify(currentHistory.slice(-5))); // Log last 5 for brevity
                    const aiResponseText = await this.geminiService.askGeminiWithHistory(currentHistory);
                    console.log("FileService: POST-CALL to geminiService.askGeminiWithHistory. Response:", aiResponseText.substring(0,100) + "...");
                    webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: aiResponseText });
                    // Add AI's response to history
                    currentHistory.push({ role: "model", parts: [{ text: aiResponseText }] });
                } catch (geminiError) {
                    const errorMsg = `Gemini API Error: ${geminiError instanceof Error ? geminiError.message : String(geminiError)}`;
                    console.error("FileService: Error calling Gemini Service:", geminiError);
                    webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: errorMsg });
                    // Add the error to history so the model knows it failed, but don't send this error back to Gemini
                    currentHistory.push({ role: "model", parts: [{ text: `System Error: ${errorMsg}` }] });
                }
            }
        } catch (error) {
            // Catch any unexpected errors in the handler itself
            const unexpectedErrorMsg = `An unexpected error occurred: ${error instanceof Error ? error.message : String(error)}`;
            console.error("FileService: Unexpected error in handleChatMessage:", error);
            webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: unexpectedErrorMsg });
            currentHistory.push({ role: "model", parts: [{ text: `System Error: ${unexpectedErrorMsg}` }] });
        } finally {
            // Always update the conversation history
            this.conversationHistory.set(historyKey, currentHistory);
            console.log("FileService: Updated conversation history. New length:", currentHistory.length);
        }
    }

    /**
     * Applies the given content to the specified file path.
     * This is a placeholder and needs to be implemented.
     * @param filePath The path of the file to apply changes to.
     * @param newContent The new content for the file.
     */
    public async applyChanges(filePath: string, newContent: string): Promise<void> {
        console.log(`FileService.applyChanges called for ${filePath}`);
        let workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            workspaceFolders = [];
        }
        if (workspaceFolders.length === 0) {
           vscode.window.showErrorMessage("Cannot apply changes: No workspace folder open.");
           return;
        }
        const rootUri = workspaceFolders[0].uri;
        // Ensure filePath is treated as relative to the workspace root
        const fileUri = vscode.Uri.joinPath(rootUri, path.normalize(filePath));

        try {
            await this.writeFile(fileUri, newContent);
            vscode.window.showInformationMessage(`Changes applied to ${filePath}`);
        } catch (error) {
            // writeFile already shows an error message if configured to do so
            console.error(`Failed to apply changes to ${filePath}:`, error);
            // Optionally, show another message here if writeFile's messages are suppressed
        }
    }
}
