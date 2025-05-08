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
    private conversationHistory: Map<string, Content[]> = new Map();

    // Define constants for webview commands to ensure consistency
    private readonly WEBVIEW_COMMANDS = {
        SHOW_FILE_PREVIEW: 'showFilePreview', // For write/create previews
        CONFIRM_DELETE: 'confirmDelete',      // For delete confirmation
        GEMINI_RESPONSE: 'geminiResponse',    // For regular AI or system messages
        ERROR: 'error'                        // For error messages
    };

    constructor(context: vscode.ExtensionContext, geminiService: GeminiService) {
        this.context = context;
        this.geminiService = geminiService;
        console.log("FileService instantiated with context and geminiService.");
    }

    /**
     * Resolves a relative path against the workspace root and performs security checks.
     * @param relativePath The relative path from user input.
     * @param webview The webview to post error messages to.
     * @returns A vscode.Uri if the path is valid and within the workspace, otherwise null.
     */
    private async secureResolvePath(relativePath: string, webview: vscode.Webview): Promise<vscode.Uri | null> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: 'No workspace folder is open. Cannot resolve path.' });
            return null;
        }
        const rootUri = workspaceFolder.uri;
        let targetUri: vscode.Uri;

        try {
            // Normalize the path to prevent directory traversal issues like '..'
            // and ensure it's treated as relative.
            const normalizedPath = path.normalize(relativePath).replace(/^(\.\.(\/|\|$))+/, '');
            if (normalizedPath === '' || normalizedPath === '.' || normalizedPath === '..') {
                webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: `Invalid or ambiguous path specified: ${relativePath}` });
                return null;
            }
            targetUri = vscode.Uri.joinPath(rootUri, normalizedPath);
        } catch (e) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: `Invalid path format: ${relativePath}. ${e instanceof Error ? e.message : String(e)}` });
            return null;
        }

        if (!targetUri.fsPath.startsWith(rootUri.fsPath)) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: `Access denied: Path '${relativePath}' is outside the workspace.` });
            return null;
        }
        return targetUri;
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

            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                vscode.window.showWarningMessage(`File not found: ${fileUri.fsPath}`);
            } else {
                vscode.window.showErrorMessage(`Failed to read file: ${fileUri.fsPath}. ${errorMessage}`);
            }
            throw error;
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
                // User messages for write success are better handled by the calling function
                // to provide more context (e.g., "File created", "Changes applied")
                // console.log(`Successfully wrote to ${fileUri.fsPath}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error writing file ${fileUri.fsPath}:`, error);
            if (options.showUserMessages) {
                vscode.window.showErrorMessage(`Failed to write file: ${fileUri.fsPath}. ${errorMessage}`);
            }
            throw error;
        }
    }

    private async createTemporaryFile(content: string, prefix: string = 'gemini-diff-'): Promise<vscode.Uri> {
        const tempDir = os.tmpdir();
        const tempFileName = `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 8)}.tmp`;
        const tempFilePath = path.join(tempDir, tempFileName);
        const tempFileUri = vscode.Uri.file(tempFilePath);
        await this.writeFile(tempFileUri, content, { showUserMessages: false });
        return tempFileUri;
    }

    public async showDiff(originalFileUri: vscode.Uri, proposedContent: string, title?: string): Promise<void> {
        try {
            const proposedTempUri = await this.createTemporaryFile(proposedContent, `proposed-${path.basename(originalFileUri.fsPath)}-`);
            const diffTitle = title || `Diff: ${path.basename(originalFileUri.fsPath)}`;
            await vscode.commands.executeCommand('vscode.diff', originalFileUri, proposedTempUri, diffTitle);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error showing diff for ${originalFileUri.fsPath}:`, error);
            vscode.window.showErrorMessage(`Failed to show diff: ${errorMessage}`);
        }
    }

    // --- Command Handlers ---

    private async handleReadCommand(args: string, webview: vscode.Webview, currentHistory: Content[]): Promise<void> {
        const filePath = args.trim();
        if (!filePath) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: "Please specify a file path after /read (e.g., /read src/extension.ts)." });
            currentHistory.push({ role: "model", parts: [{ text: "Error: User did not specify a file path for /read." }] });
            return;
        }

        const fileUri = await this.secureResolvePath(filePath, webview);
        if (!fileUri) return; // secureResolvePath already sent an error message

        try {
            const fileContent = await this.readFile(fileUri);
            const responseText = `Content of ${filePath}:\n\`\`\`\n${fileContent.substring(0, 1000)}\n\`\`\`${fileContent.length > 1000 ? '\n... (file truncated)' : ''}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'system', text: responseText });
            currentHistory.push({ role: "model", parts: [{ text: `Successfully read and displayed content of ${filePath}. The content started with: ${fileContent.substring(0, 200)}...` }] });
        } catch (readError) {
            const errorMsg = `Failed to read file ${filePath}: ${readError instanceof Error ? readError.message : String(readError)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
            currentHistory.push({ role: "model", parts: [{ text: `Error: Failed to read file ${filePath}. Details: ${errorMsg}` }] });
        }
    }

    private async handleListCommand(args: string, webview: vscode.Webview, currentHistory: Content[]): Promise<void> {
        const dirPath = args.trim() || '.'; // Default to workspace root if no path is given
        const dirUri = await this.secureResolvePath(dirPath, webview);
        if (!dirUri) return;

        try {
            const entries = await vscode.workspace.fs.readDirectory(dirUri);
            let files = [];
            let directories = [];
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File) {
                    files.push(name);
                } else if (type === vscode.FileType.Directory) {
                    directories.push(name + '/'); // Add trailing slash for directories
                }
            }
            let responseText = `Contents of ${dirPath}:\n`;
            if (directories.length > 0) {
                responseText += `Directories:\n${directories.map(d => `- ${d}`).join('\n')}\n`;
            }
            if (files.length > 0) {
                responseText += `Files:\n${files.map(f => `- ${f}`).join('\n')}\n`;
            }
            if (files.length === 0 && directories.length === 0) {
                responseText += "(empty directory)";
            }
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'system', text: responseText });
            currentHistory.push({ role: "model", parts: [{ text: `Listed contents of directory: ${dirPath}` }] });
        } catch (listError) {
            const errorMsg = `Failed to list directory ${dirPath}: ${listError instanceof Error ? listError.message : String(listError)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
            currentHistory.push({ role: "model", parts: [{ text: `Error: Failed to list directory ${dirPath}. Details: ${errorMsg}` }] });
        }
    }

    private async handleCreateCommand(args: string, webview: vscode.Webview, currentHistory: Content[]): Promise<void> {
        const parts = args.match(/^(\S+)\s*(.*)$/s); // Path and optional content description
        if (!parts || !parts[1]) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: "Usage: /create <filePath> [description of content for Gemini to generate]" });
            currentHistory.push({ role: "model", parts: [{ text: "Error: Invalid /create command." }] });
            return;
        }
        const filePath = parts[1];
        const contentDescription = parts[2] || "an empty file";

        const fileUri = await this.secureResolvePath(filePath, webview);
        if (!fileUri) return;

        // Check if file already exists
        try {
            await vscode.workspace.fs.stat(fileUri);
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: `File already exists: ${filePath}. Use /write to modify.` });
            currentHistory.push({ role: "model", parts: [{ text: `Error: Attempted to create existing file ${filePath}.` }] });
            return;
        } catch (e) {
            // File does not exist, which is good for /create
        }

        webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'system', text: `Okay, I will try to create '${filePath}' with content described as: '${contentDescription}'. I'll ask Gemini to generate the content and then show you a preview.` });

        try {
            const promptForGemini = `Create the content for a new file named '${filePath}'. The file should contain: ${contentDescription}. Only output the raw file content, without any explanations or markdown formatting.`;
            currentHistory.push({ role: "user", parts: [{ text: promptForGemini }] }); // Add this specific task to history for Gemini
            const proposedContent = await this.geminiService.askGeminiWithHistory(currentHistory);
            // Remove the synthetic user prompt from history after getting the content
            currentHistory.pop(); 
            currentHistory.push({ role: "model", parts: [{ text: `Proposed content for ${filePath}:\n${proposedContent}` }] });


            // Send to webview for confirmation
            webview.postMessage({
                command: this.WEBVIEW_COMMANDS.SHOW_FILE_PREVIEW,
                action: 'create', // Differentiates from 'write' action in webview
                filePath: filePath, // Relative path for display and message back
                proposedContent: proposedContent,
                message: `Gemini proposes creating '${filePath}' with the following content. Review and confirm.`
            });
        } catch (geminiError) {
            const errorMsg = `Error asking Gemini to generate content for ${filePath}: ${geminiError instanceof Error ? geminiError.message : String(geminiError)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
            currentHistory.push({ role: "model", parts: [{ text: `Error: ${errorMsg}` }] });
        }
    }

    private async handleWriteCommand(args: string, webview: vscode.Webview, currentHistory: Content[]): Promise<void> {
        const parts = args.match(/^(\S+)\s*(.*)$/s); // Path and instruction for modification
        if (!parts || !parts[1] || !parts[2]) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: "Usage: /write <filePath> <description of changes for Gemini>" });
            currentHistory.push({ role: "model", parts: [{ text: "Error: Invalid /write command." }] });
            return;
        }
        const filePath = parts[1];
        const changeDescription = parts[2];

        const fileUri = await this.secureResolvePath(filePath, webview);
        if (!fileUri) return;

        let originalContent = "";
        try {
            originalContent = await this.readFile(fileUri);
        } catch (e) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: `File not found or could not be read: ${filePath}. Cannot apply changes.` });
            currentHistory.push({ role: "model", parts: [{ text: `Error: File ${filePath} not found for /write.` }] });
            return;
        }

        webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'system', text: `Okay, I will try to modify '${filePath}' based on: '${changeDescription}'. I'll ask Gemini for the new content and then show you a preview/diff.` });

        try {
            const promptForGemini = `The current content of the file '${filePath}' is:\n\`\`\`\n${originalContent}\n\`\`\`\n\nPlease modify this content based on the following instruction: "${changeDescription}". Only output the complete new raw file content, without any explanations or markdown formatting.`;
            currentHistory.push({ role: "user", parts: [{ text: promptForGemini }] });
            const proposedContent = await this.geminiService.askGeminiWithHistory(currentHistory);
            currentHistory.pop(); // Remove the synthetic user prompt
            currentHistory.push({ role: "model", parts: [{ text: `Proposed new content for ${filePath}:\n${proposedContent}` }] });

            // Send to webview for confirmation (could also use vscode.diff here)
            webview.postMessage({
                command: this.WEBVIEW_COMMANDS.SHOW_FILE_PREVIEW,
                action: 'write',
                filePath: filePath, // Relative path
                originalContent: originalContent, // For webview-side diff if implemented
                proposedContent: proposedContent,
                message: `Gemini proposes modifying '${filePath}'. Review the changes and confirm.`
            });
             // Optionally, also trigger vscode.diff
            // this.showDiff(fileUri, proposedContent, `Proposed changes for ${filePath}`);

        } catch (geminiError) {
            const errorMsg = `Error asking Gemini to modify content for ${filePath}: ${geminiError instanceof Error ? geminiError.message : String(geminiError)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
            currentHistory.push({ role: "model", parts: [{ text: `Error: ${errorMsg}` }] });
        }
    }

    private async handleDeleteCommand(args: string, webview: vscode.Webview, currentHistory: Content[]): Promise<void> {
        const filePath = args.trim();
        if (!filePath) {
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: "Please specify a file path after /delete." });
            currentHistory.push({ role: "model", parts: [{ text: "Error: Missing file path for /delete." }] });
            return;
        }

        const fileUri = await this.secureResolvePath(filePath, webview);
        if (!fileUri) return;

        // Send to webview for explicit confirmation
        webview.postMessage({
            command: this.WEBVIEW_COMMANDS.CONFIRM_DELETE,
            filePath: filePath, // Relative path
            message: `Are you absolutely sure you want to delete '${filePath}'? This action cannot be easily undone.`
        });
        currentHistory.push({ role: "model", parts: [{ text: `User asked to delete ${filePath}. Awaiting confirmation.` }] });
    }

    private async handleGeneralQuery(messageText: string, webview: vscode.Webview, currentHistory: Content[]): Promise<void> {
        console.log("FileService: Attempting to process general query with Gemini.");
        try {
            const aiResponseText = await this.geminiService.askGeminiWithHistory(currentHistory);
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'gemini', text: aiResponseText });
            currentHistory.push({ role: "model", parts: [{ text: aiResponseText }] });
        } catch (geminiError) {
            const errorMsg = `Gemini API Error: ${geminiError instanceof Error ? geminiError.message : String(geminiError)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
            currentHistory.push({ role: "model", parts: [{ text: `System Error during general query: ${errorMsg}` }] });
        }
    }


    public async handleChatMessage(messageText: string, webview: vscode.Webview): Promise<void> {
        console.log(`FileService.handleChatMessage received: "${messageText}"`);
        const historyKey = 'globalChat'; // Or a panel-specific key if you have multiple panels
        let currentHistory = this.conversationHistory.get(historyKey) || [];

        // Add user's message to history BEFORE any processing
        currentHistory.push({ role: "user", parts: [{ text: messageText }] });

        try {
            const lowerMessage = messageText.toLowerCase();
            if (lowerMessage.startsWith('/read ')) {
                await this.handleReadCommand(messageText.substring(5), webview, currentHistory);
            } else if (lowerMessage.startsWith('/list')) { // Allow /list or /list <path>
                await this.handleListCommand(messageText.substring(lowerMessage.startsWith('/list ') ? 6 : 5), webview, currentHistory);
            } else if (lowerMessage.startsWith('/create ')) {
                await this.handleCreateCommand(messageText.substring(8), webview, currentHistory);
            } else if (lowerMessage.startsWith('/write ')) {
                await this.handleWriteCommand(messageText.substring(7), webview, currentHistory);
            } else if (lowerMessage.startsWith('/delete ')) {
                await this.handleDeleteCommand(messageText.substring(8), webview, currentHistory);
            } else {
                await this.handleGeneralQuery(messageText, webview, currentHistory);
            }
        } catch (error) {
            const unexpectedErrorMsg = `An unexpected error occurred while handling your command: ${error instanceof Error ? error.message : String(error)}`;
            console.error("FileService: Unexpected error in handleChatMessage:", error);
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: unexpectedErrorMsg });
            currentHistory.push({ role: "model", parts: [{ text: `System Error: ${unexpectedErrorMsg}` }] });
        } finally {
            this.conversationHistory.set(historyKey, currentHistory);
            console.log("FileService: Updated conversation history. New length:", currentHistory.length);
        }
    }

    // --- Methods called from extension.ts based on webview messages ---

    public async performConfirmedCreate(filePath: string, content: string, webview: vscode.Webview): Promise<void> {
        const fileUri = await this.secureResolvePath(filePath, webview);
        if (!fileUri) return;

        try {
            // Double check it doesn't exist (though create command should have checked)
            try {
                await vscode.workspace.fs.stat(fileUri);
                webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: `File already exists: ${filePath}. Creation aborted.` });
                return;
            } catch (e) { /* Expected: file does not exist */ }

            await this.writeFile(fileUri, content, { showUserMessages: false });
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'system', text: `Successfully created file: ${filePath}` });
            // Optionally, open the file: vscode.window.showTextDocument(fileUri);
        } catch (error) {
            const errorMsg = `Failed to create file ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
        }
    }

    public async performConfirmedWrite(filePath: string, newContent: string, webview: vscode.Webview): Promise<void> {
        const fileUri = await this.secureResolvePath(filePath, webview);
        if (!fileUri) return;

        try {
            await this.writeFile(fileUri, newContent, { showUserMessages: false });
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'system', text: `Changes applied to: ${filePath}` });
        } catch (error) {
            const errorMsg = `Failed to apply changes to ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
        }
    }

    public async performConfirmedDelete(filePath: string, webview: vscode.Webview): Promise<void> {
        const fileUri = await this.secureResolvePath(filePath, webview);
        if (!fileUri) return;

        try {
            await vscode.workspace.fs.delete(fileUri, { useTrash: true }); // Use trash if possible
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.GEMINI_RESPONSE, sender: 'system', text: `Successfully deleted: ${filePath}` });
        } catch (error) {
            const errorMsg = `Failed to delete ${filePath}: ${error instanceof Error ? error.message : String(error)}`;
            webview.postMessage({ command: this.WEBVIEW_COMMANDS.ERROR, sender: 'system', text: errorMsg });
        }
    }

    /**
     * This method is kept for compatibility if the webview sends a generic 'applyChanges'
     * but should ideally be replaced by more specific command handlers like performConfirmedWrite.
     */
    public async applyChanges(filePath: string, newContent: string): Promise<void> {
        console.warn(`FileService.applyChanges called directly for ${filePath}. Consider using performConfirmedWrite for better clarity.`);
        const dummyWebview = { postMessage: (message: any) => console.log("Dummy webview received (from applyChanges):", message) } as vscode.Webview;
        await this.performConfirmedWrite(filePath, newContent, dummyWebview);
        // Note: This won't send feedback to the actual webview unless it's passed in.
        // The original caller in extension.ts should handle webview feedback.
    }
}
