// c:\Users\marti\gemini-fs\src\fileOperationCommands.ts
import * as vscode from 'vscode';
import { GeminiService, ChatMessage } from './geminiService';
import { readFileContentUtil, writeFileContentUtil, resolvePathUtil, ensureWorkspaceOpenUtil } from './fileSystemUtils';

// Constants from FileService, could be moved to a shared constants file or passed if they vary
const MAX_FILE_SIZE_FOR_READ = 5 * 1024 * 1024;
const MAX_FILE_SIZE_FOR_WRITE_PREVIEW = 1 * 1024 * 1024;

export class FileOperationCommands {
    constructor(
        private getWorkspaceRoot: () => vscode.Uri | undefined,
        private showSystemMessage: (webview: vscode.Webview, message: string, historyToUpdate?: ChatMessage[]) => void,
        private currentHistory: ChatMessage[], // Direct reference for reading and appending
        private geminiService: GeminiService,
        private getContextualContent: () => { path: string, content: string }[]
    ) {}

    private _resolvePath(rawPath: string, webview: vscode.Webview, historyToUpdateForMessage?: ChatMessage[]): { uri: vscode.Uri, relativePath: string } | null {
        return resolvePathUtil(rawPath, this.getWorkspaceRoot(), webview, this.showSystemMessage, historyToUpdateForMessage ?? this.currentHistory);
    }
    
    private _ensureWorkspaceOpen(webview: vscode.Webview): boolean {
        return ensureWorkspaceOpenUtil(this.getWorkspaceRoot(), webview, this.showSystemMessage, this.currentHistory);
    }

    public async handleReadCommand(messageText: string, webview: vscode.Webview): Promise<void> {
        const filePath = messageText.substring('/read '.length).trim();
        if (!filePath) {
            this.showSystemMessage(webview, "Usage: /read <filePath>", this.currentHistory);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        const resolvedPath = this._resolvePath(filePath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        try {
            const stat = await vscode.workspace.fs.stat(resolvedPath.uri);
            if (stat.type !== vscode.FileType.File) {
                this.showSystemMessage(webview, `Path is not a file: ${resolvedPath.relativePath}`, this.currentHistory);
                webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
                return;
            }
            if (stat.size > MAX_FILE_SIZE_FOR_READ) {
                this.showSystemMessage(webview, `File is too large to read directly (${(stat.size / (1024*1024)).toFixed(2)}MB). Max size: ${(MAX_FILE_SIZE_FOR_READ / (1024*1024))}MB.`, this.currentHistory);
                webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
                return;
            }

            const content = await readFileContentUtil(resolvedPath.uri);
            const contentMessage: ChatMessage = {
                role: 'model',
                parts: [{ text: `Content of ${resolvedPath.relativePath}:\n\`\`\`\n${content}\n\`\`\`` }]
            };
            this.currentHistory.push(contentMessage);
            webview.postMessage({ command: 'fileRead', filePath: resolvedPath.relativePath, content: content, history: [...this.currentHistory] });
        } catch (error: any) {
            let errorMsg = '';
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                errorMsg = `File not found: ${resolvedPath.relativePath}`;
            } else {
                errorMsg = `Error reading file ${resolvedPath.relativePath}: ${error.message}`;
            }
            this.showSystemMessage(webview, errorMsg, this.currentHistory);
            console.error(`Error in handleReadCommand for ${resolvedPath.relativePath}:`, error);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
        }
    }

    public async handleListCommand(messageText: string, webview: vscode.Webview): Promise<void> {
        const folderPath = messageText.substring('/list'.length).trim() || '.';
        const resolvedPath = this._resolvePath(folderPath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        try {
            const stat = await vscode.workspace.fs.stat(resolvedPath.uri);
            if (stat.type !== vscode.FileType.Directory) {
                this.showSystemMessage(webview, `Path is not a directory: ${resolvedPath.relativePath}`, this.currentHistory);
                webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
                return;
            }

            const entries = await vscode.workspace.fs.readDirectory(resolvedPath.uri);
            let listing = `Directory listing for ${resolvedPath.relativePath}:\n`;
            listing += entries.map(([name, type]) => `${name}${type === vscode.FileType.Directory ? '/' : ''}`).join('\n');

            const listingResponseMessage: ChatMessage = { role: 'model', parts: [{ text: listing }] };
            this.currentHistory.push(listingResponseMessage);
            webview.postMessage({ command: 'directoryListed', path: resolvedPath.relativePath, listing: listing, history: [...this.currentHistory] });
        } catch (error: any) {
            let errorMsg = '';
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                errorMsg = `Directory not found: ${resolvedPath.relativePath}`;
            } else {
                errorMsg = `Error listing directory ${resolvedPath.relativePath}: ${error.message}`;
            }
            this.showSystemMessage(webview, errorMsg, this.currentHistory);
            console.error(`Error in handleListCommand for ${resolvedPath.relativePath}:`, error);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
        }
    }

    public async handleCreateCommand(messageText: string, webview: vscode.Webview, apiKey: string, modelToUse: string): Promise<void> {
        const parts = messageText.substring('/create '.length).trim().match(/^(\S+)\s*(.*)$/);
        if (!parts) {
            this.showSystemMessage(webview, "Usage: /create <filePath> [description of content]", this.currentHistory);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }
        const filePath = parts[1];
        const description = parts[2] || "Create an empty file.";

        const resolvedPath = this._resolvePath(filePath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        try {
            await vscode.workspace.fs.stat(resolvedPath.uri);
            this.showSystemMessage(webview, `File already exists: ${resolvedPath.relativePath}. Use /write to modify it.`, this.currentHistory);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        } catch (error: any) {
            if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
                this.showSystemMessage(webview, `Error checking file ${resolvedPath.relativePath}: ${error.message}`, this.currentHistory);
                console.error(`Error in handleCreateCommand stat for ${resolvedPath.relativePath}:`, error);
                webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
                return;
            }
        }

        if (!apiKey || !modelToUse) {
            this.showSystemMessage(webview, "API key or model not set. Cannot generate content.", this.currentHistory);
            webview.postMessage({
                command: 'showFilePreviewForCreate',
                filePath: resolvedPath.relativePath,
                proposedContent: '',
                description: "API key/model not set. Create empty file?",
                history: [...this.currentHistory]
            });
            return;
        }

        this.showSystemMessage(webview, `Gemini is generating content for ${resolvedPath.relativePath}...`);
        
        const historyForGemini: ChatMessage[] = [
            ...this.currentHistory.slice(0, -1), 
            { role: 'user', parts: [{ text: `Generate content for a new file named "${resolvedPath.relativePath}" based on the following description: ${description}. Provide only the raw file content.` }] }
        ];
        
        const contextualContent = this.getContextualContent();
        if (contextualContent.length > 0) {
            const contextPreambleMessages: ChatMessage[] = [];
            contextualContent.forEach(item => {
                contextPreambleMessages.push({ role: 'user', parts: [{ text: `CONTEXT FILE: ${item.path}\n\`\`\`\n${item.content}\n\`\`\`` }] });
                contextPreambleMessages.push({ role: 'model', parts: [{ text: `Acknowledged context for ${item.path}.` }] });
            });
            historyForGemini.splice(-1, 0, ...contextPreambleMessages);
        }

        try {
            const generatedContent = await this.geminiService.askGeminiWithHistory(historyForGemini);
            this.currentHistory.push({ role: 'model', parts: [{ text: `Okay, I've generated content for ${resolvedPath.relativePath}. Please review and confirm.` }] });
            webview.postMessage({
                command: 'showFilePreviewForCreate',
                filePath: resolvedPath.relativePath,
                proposedContent: generatedContent,
                description: `Preview of content for ${resolvedPath.relativePath}:`,
                history: [...this.currentHistory]
            });
        } catch (error: any) {
            const errorMessage = `Error generating content with Gemini: ${error.message || 'Unknown error'}`;
            this.showSystemMessage(webview, errorMessage, this.currentHistory);
            console.error(errorMessage, error);
            webview.postMessage({
                command: 'showFilePreviewForCreate',
                filePath: resolvedPath.relativePath,
                proposedContent: '',
                description: `Error generating content. Create empty file for ${resolvedPath.relativePath}?`,
                history: [...this.currentHistory]
            });
        }
    }

    public async performConfirmedCreate(filePath: string, content: string, webview: vscode.Webview): Promise<void> {
        const resolvedPath = this._resolvePath(filePath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }
        try {
            await writeFileContentUtil(resolvedPath.uri, content);
            const successMsg = `File created: ${resolvedPath.relativePath}`;
            this.showSystemMessage(webview, successMsg, this.currentHistory);
            webview.postMessage({ command: 'operationSuccess', message: successMsg, history: [...this.currentHistory] });
        } catch (error: any) {
            const errorMsg = `Error creating file ${resolvedPath.relativePath}: ${error.message}`;
            this.showSystemMessage(webview, errorMsg, this.currentHistory);
            console.error(errorMsg, error);
            webview.postMessage({ command: 'operationError', message: errorMsg, history: [...this.currentHistory] });
        }
    }

    public async handleWriteCommand(messageText: string, webview: vscode.Webview, apiKey: string, modelToUse: string): Promise<void> {
        const parts = messageText.substring('/write '.length).trim().match(/^(\S+)\s*(.*)$/);
        if (!parts) {
            this.showSystemMessage(webview, "Usage: /write <filePath> <description of changes>", this.currentHistory);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }
        const filePath = parts[1];
        const description = parts[2];

        if (!description) {
            this.showSystemMessage(webview, "Please provide a description of the changes for the /write command.", this.currentHistory);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        const resolvedPath = this._resolvePath(filePath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        let originalContent: string;
        try {
            const stat = await vscode.workspace.fs.stat(resolvedPath.uri);
            if (stat.type !== vscode.FileType.File) {
                this.showSystemMessage(webview, `Path is not a file: ${resolvedPath.relativePath}`, this.currentHistory);
                webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
                return;
            }
            if (stat.size > MAX_FILE_SIZE_FOR_WRITE_PREVIEW) {
                this.showSystemMessage(webview, `File is too large to modify with AI assistance (${(stat.size / (1024*1024)).toFixed(2)}MB). Max size: ${(MAX_FILE_SIZE_FOR_WRITE_PREVIEW / (1024*1024))}MB.`, this.currentHistory);
                webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
                return;
            }
            originalContent = await readFileContentUtil(resolvedPath.uri);
        } catch (error: any) {
            let errorMsg = '';
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                errorMsg = `File not found: ${resolvedPath.relativePath}. Use /create to make a new file.`;
            } else {
                errorMsg = `Error reading file ${resolvedPath.relativePath}: ${error.message}`;
            }
            this.showSystemMessage(webview, errorMsg, this.currentHistory);
            console.error(`Error in handleWriteCommand reading file ${resolvedPath.relativePath}:`, error);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        if (!apiKey || !modelToUse) {
            this.showSystemMessage(webview, "API key or model not set. Cannot generate content modifications.", this.currentHistory);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        this.showSystemMessage(webview, `Gemini is analyzing ${resolvedPath.relativePath} and preparing modifications...`);

        const historyForGemini: ChatMessage[] = [
            ...this.currentHistory.slice(0,-1),
            { role: 'user', parts: [{ text: `The current content of the file "${resolvedPath.relativePath}" is:\n\`\`\`\n${originalContent}\n\`\`\`\n\nPlease modify this content based on the following instruction: ${description}. Provide the complete new content of the file. Output only the raw file content.` }] }
        ];
        
        const contextualContent = this.getContextualContent();
        if (contextualContent.length > 0) {
            const contextPreambleMessages: ChatMessage[] = [];
            contextualContent.forEach(item => {
                if (item.path !== resolvedPath.relativePath) {
                    contextPreambleMessages.push({ role: 'user', parts: [{ text: `CONTEXT FILE: ${item.path}\n\`\`\`\n${item.content}\n\`\`\`` }] });
                    contextPreambleMessages.push({ role: 'model', parts: [{ text: `Acknowledged context for ${item.path}.` }] });
                }
            });
            historyForGemini.splice(-1, 0, ...contextPreambleMessages);
        }

        try {
            const proposedNewContent = await this.geminiService.askGeminiWithHistory(historyForGemini);
            this.currentHistory.push({ role: 'model', parts: [{ text: `Okay, I've prepared modifications for ${resolvedPath.relativePath}. Please review and confirm.` }] });
            webview.postMessage({
                command: 'showFilePreviewForWrite',
                filePath: resolvedPath.relativePath,
                originalContent: originalContent,
                proposedContent: proposedNewContent,
                description: `Review proposed changes for ${resolvedPath.relativePath}:`,
                history: [...this.currentHistory]
            });
        } catch (error: any) {
            const errorMessage = `Error generating modifications with Gemini: ${error.message || 'Unknown error'}`;
            this.showSystemMessage(webview, errorMessage, this.currentHistory);
            console.error(errorMessage, error);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
        }
    }

    public async performConfirmedWrite(filePath: string, newContent: string, webview: vscode.Webview): Promise<void> {
        const resolvedPath = this._resolvePath(filePath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }
        try {
            await writeFileContentUtil(resolvedPath.uri, newContent);
            const successMsg = `File updated: ${resolvedPath.relativePath}`;
            this.showSystemMessage(webview, successMsg, this.currentHistory);
            webview.postMessage({ command: 'operationSuccess', message: successMsg, history: [...this.currentHistory] });
        } catch (error: any) {
            const errorMsg = `Error writing file ${resolvedPath.relativePath}: ${error.message}`;
            this.showSystemMessage(webview, errorMsg, this.currentHistory);
            console.error(errorMsg, error);
            webview.postMessage({ command: 'operationError', message: errorMsg, history: [...this.currentHistory] });
        }
    }

    public async handleDeleteCommand(messageText: string, webview: vscode.Webview): Promise<void> {
        const filePath = messageText.substring('/delete '.length).trim();
        if (!filePath) {
            this.showSystemMessage(webview, "Usage: /delete <filePath>", this.currentHistory);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }
        const resolvedPath = this._resolvePath(filePath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }

        try {
            await vscode.workspace.fs.stat(resolvedPath.uri);
            webview.postMessage({
                command: 'confirmDelete',
                filePath: resolvedPath.relativePath,
                history: [...this.currentHistory]
            });
        } catch (error: any) {
            let errorMsg = '';
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                errorMsg = `File or folder not found: ${resolvedPath.relativePath}`;
            } else {
                errorMsg = `Error accessing path ${resolvedPath.relativePath}: ${error.message}`;
            }
            this.showSystemMessage(webview, errorMsg, this.currentHistory);
            console.error(`Error in handleDeleteCommand for ${resolvedPath.relativePath}:`, error);
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
        }
    }

    public async performConfirmedDelete(filePath: string, webview: vscode.Webview, contextualContentRef: { path: string, content: string }[]): Promise<void> {
        const resolvedPath = this._resolvePath(filePath, webview);
        if (!resolvedPath) {
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return;
        }
        try {
            await vscode.workspace.fs.delete(resolvedPath.uri, { recursive: true });
            const successMsg = `Successfully deleted: ${resolvedPath.relativePath}`;
            this.showSystemMessage(webview, successMsg, this.currentHistory);
            
            const contextIndex = contextualContentRef.findIndex(c => c.path === resolvedPath.relativePath);
            if (contextIndex > -1) {
                contextualContentRef.splice(contextIndex, 1);
                this.showSystemMessage(webview, `Removed ${resolvedPath.relativePath} from context as it was deleted.`, this.currentHistory);
            }
            webview.postMessage({ command: 'operationSuccess', message: successMsg, history: [...this.currentHistory] });
        } catch (error: any) {
            const errorMsg = `Error deleting ${resolvedPath.relativePath}: ${error.message}`;
            this.showSystemMessage(webview, errorMsg, this.currentHistory);
            console.error(errorMsg, error);
            webview.postMessage({ command: 'operationError', message: errorMsg, history: [...this.currentHistory] });
        }
    }
}
