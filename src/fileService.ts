import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { GeminiService } from './geminiService'; // Import GeminiService

/**
 * Service class for handling file system operations within the VS Code workspace.
 */
export class FileService {
    private context: vscode.ExtensionContext;
    private geminiService: GeminiService;

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
        console.log(`FileService.handleChatMessage received: ${messageText}`);
        try {
            // Example: Parse messageText for commands like "/read <filepath>"
            if (messageText.toLowerCase().startsWith('/read ')) {
                const filePath = messageText.substring(6).trim();
                // Basic validation: ensure filePath is not empty
                if (!filePath) {
                    webview.postMessage({ command: 'error', text: "Please specify a file path after /read." });
                    return;
                }

                // Attempt to resolve the file path relative to the first workspace folder
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    webview.postMessage({ command: 'error', text: "No workspace folder open to read files from." });
                    return;
                }
                const rootUri = workspaceFolders[0].uri;
                const fileUri = vscode.Uri.joinPath(rootUri, filePath);

                try {
                    const fileContent = await this.readFile(fileUri);
                    // For now, just send the raw content. Later, you might send it to Gemini.
                    webview.postMessage({ command: 'geminiResponse', text: `Content of ${filePath}:\n${fileContent.substring(0, 500)}${fileContent.length > 500 ? '...' : ''}` });

                    // Example: If you wanted to get Gemini to *do* something with the file content:
                    // const geminiPrompt = `The user wants to work with the file "${filePath}". Its content is:\n\n${fileContent}\n\nWhat should I do next based on their original request: "${messageText}"?`;
                    // const geminiResponse = await this.geminiService.askGeminiWithHistory([{role: "user", parts: [{text: geminiPrompt}]}]);
                    // webview.postMessage({ command: 'geminiResponse', text: geminiResponse });

                } catch (error) {
                    // readFile already shows messages for common errors like FileNotFound
                    // So, we might not need to post another one unless it's a different kind of error
                    // or we want to provide more context in the chat.
                    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred while reading the file.";
                    console.error(`Error in /read command for ${filePath}:`, error);
                    webview.postMessage({ command: 'error', text: `Could not read file ${filePath}: ${errorMessage}` });
                }

            } else {
                // If not a /read command, assume it's a general query for Gemini
                // (You'll expand this to handle other commands like /edit, /create, etc.)
                // const history: Content[] = [{ role: "user", parts: [{ text: messageText }] }];
                // const response = await this.geminiService.askGeminiWithHistory(history);
                // webview.postMessage({ command: 'geminiResponse', text: response });
                webview.postMessage({ command: 'geminiResponse', text: `Received: "${messageText}". AI processing for general queries is not fully implemented here yet.` });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error in handleChatMessage:", error);
            webview.postMessage({ command: 'error', text: `Error processing message: ${errorMessage}` });
        }
    }

    /**
     * Applies the given new content to the specified file path.
     * @param filePath The path of the file to update (needs to be resolved to a vscode.Uri).
     * @param newContent The new content for the file.
     */
    public async applyChanges(filePath: string, newContent: string): Promise<void> {
        console.log(`FileService.applyChanges called for ${filePath} with new content length ${newContent.length}`);
        try {
            // filePath from the webview might be a simple string.
            // It needs to be resolved to a full vscode.Uri, likely relative to the workspace.
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage("No workspace folder open to apply changes to.");
                console.error("ApplyChanges: No workspace folder open.");
                return; // Or throw an error
            }
            // Assuming filePath is relative to the first workspace folder.
            // For multi-root workspaces, you might need a more sophisticated way to determine the correct root.
            const fileUri = vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);

            await this.writeFile(fileUri, newContent);
            vscode.window.showInformationMessage(`Changes applied to ${filePath}`);
            console.log(`Successfully applied changes to ${fileUri.fsPath}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error applying changes to ${filePath}:`, error);
            vscode.window.showErrorMessage(`Failed to apply changes to ${filePath}: ${errorMessage}`);
            // Optionally, re-throw or handle further if needed by the caller in extension.ts
        }
    }

    /**
     * Checks if a file exists at the given URI.
     * @param fileUri The URI to check.
     * @returns True if the file exists, false otherwise.
     */
    public async fileExists(fileUri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(fileUri);
            return true;
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return false;
            }
            console.error(`Error checking file existence for ${fileUri.fsPath}:`, error);
            return false;
        }
    }

    /**
     * Applies a WorkspaceEdit to the workspace.
     * @param edit The WorkspaceEdit to apply.
     * @returns True if the edit was applied successfully, false otherwise.
     */
    public async applyWorkspaceEdit(edit: vscode.WorkspaceEdit): Promise<boolean> {
        try {
            const success = await vscode.workspace.applyEdit(edit);
            if (!success) {
                console.warn('Workspace edit was not applied successfully.');
                vscode.window.showWarningMessage('Could not apply changes.');
            }
            return success;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error('Error applying workspace edit:', error);
            vscode.window.showErrorMessage(`Failed to apply changes: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Creates a WorkspaceEdit to replace the entire content of a file.
     * @param fileUri The URI of the file to replace content in.
     * @param newContent The new content for the file.
     * @returns A WorkspaceEdit object representing the change.
     */
    public async createReplaceFileContentEdit(fileUri: vscode.Uri, newContent: string): Promise<vscode.WorkspaceEdit> {
        const edit = new vscode.WorkspaceEdit();
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            edit.replace(fileUri, fullRange, newContent);
        } catch (error) {
             console.warn(`Could not open document ${fileUri.fsPath} to determine range, using large range fallback.`, error);
             const largeRange = new vscode.Range(0, 0, 99999, 0);
             edit.replace(fileUri, largeRange, newContent);
        }
        return edit;
    }
}
