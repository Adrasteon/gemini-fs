// c:\Users\marti\gemini-fs\src\fileService.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { GeminiService, ChatMessage } from './geminiService';
import { FileOperationCommands } from './fileOperationCommands';
import { readFileContentUtil, resolvePathUtil } from './fileSystemUtils'; // Only utils still directly used by FileService

// Constants for file size limits
const MAX_FILE_SIZE_FOR_CONTEXT = 500 * 1024; // 500KB limit per file for context


export interface FileServiceOptions {
    geminiService: GeminiService;
}

export class FileService {
    private geminiService: GeminiService;
    private currentWorkspaceRoot: vscode.Uri | undefined;
    private currentHistory: ChatMessage[] = [];
    private contextualContent: { path: string, content: string }[] = [];
    private fileOpCommands: FileOperationCommands;

    constructor(options: FileServiceOptions) {
        this.geminiService = options.geminiService;
        this.updateWorkspaceRoot();
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.updateWorkspaceRoot());

        this.fileOpCommands = new FileOperationCommands(
            () => this.currentWorkspaceRoot,
            (webview, message, historyToUpdate) => this.showSystemMessage(webview, message, historyToUpdate),
            this.currentHistory, // Pass the array reference
            this.geminiService,
            () => this.contextualContent
        );
        console.log("FileService: FileOperationCommands instantiated.");
    }

    private updateWorkspaceRoot() {
        this.currentWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    }

    public resetConversationHistory() {
        this.currentHistory = [];
    }

    public getCurrentHistory(): ReadonlyArray<ChatMessage> {
        return [...this.currentHistory];
    }

    private showSystemMessage(webview: vscode.Webview, message: string, historyToUpdate?: ChatMessage[]) {
        const systemMessageText = `System: ${message}`;
        const systemChatMessage: ChatMessage = { role: 'model', parts: [{ text: systemMessageText }] }; // Using 'model' role for system messages for simplicity
        if (historyToUpdate) {
            historyToUpdate.push(systemChatMessage);
        }
        // Send to webview with the raw message, webview can prefix "System:" if needed or display differently
        webview.postMessage({ command: 'systemMessage', text: message, history: historyToUpdate ? [...historyToUpdate] : undefined });
    }


    public async handleChatMessage(messageText: string, webview: vscode.Webview, apiKey: string, modelToUse: string, payload?: any) {
        if (!this.ensureWorkspaceOpen(webview)) {
            return;
        }

        // Add user's raw message to history first, unless it's a payload-only command
        if (!payload && messageText) {
             // Check if the exact same message is already the last one from the user (e.g. resend)
            const lastMessage = this.currentHistory.length > 0 ? this.currentHistory[this.currentHistory.length - 1] : null;
            if (!(lastMessage && lastMessage.role === 'user' && lastMessage.parts[0].text === messageText)) {
                this.currentHistory.push({ role: 'user', parts: [{ text: messageText }] });
            }
        }


        if (payload?.command === 'confirmCreateFile') {
            await this.fileOpCommands.performConfirmedCreate(payload.filePath, payload.content, webview);
            return;
        }
        if (payload?.command === 'confirmWriteFile') {
            await this.fileOpCommands.performConfirmedWrite(payload.filePath, payload.newContent, webview);
            return;
        }
        if (payload?.command === 'confirmDeleteFile') {
            await this.fileOpCommands.performConfirmedDelete(payload.filePath, webview, this.contextualContent);
            return;
        }


        if (messageText.startsWith('/read ')) {
            await this.fileOpCommands.handleReadCommand(messageText, webview);
        } else if (messageText.startsWith('/list')) {
            await this.fileOpCommands.handleListCommand(messageText, webview);
        } else if (messageText.startsWith('/write ')) {
            await this.fileOpCommands.handleWriteCommand(messageText, webview, apiKey, modelToUse);
        } else if (messageText.startsWith('/delete ')) {
            await this.fileOpCommands.handleDeleteCommand(messageText, webview);
        } else if (messageText.startsWith('/create ')) {
            await this.fileOpCommands.handleCreateCommand(messageText, webview, apiKey, modelToUse);
        } else if (messageText.startsWith('/context ')) {
            const argument = messageText.substring('/context '.length).trim();
            if (argument.toLowerCase() === 'clear') {
                await this.clearContext(webview);
            } else if (argument.toLowerCase() === 'list') {
                await this.listContext(webview);
            } else if (argument) {
                await this.addPathToContext(argument, webview);
            } else {
                this.showSystemMessage(webview, "Usage: /context <filePath|folderPath> | list | clear", this.currentHistory);
            }
            // After context operations, update webview with potentially changed history
            webview.postMessage({ command: 'historyUpdate', history: [...this.currentHistory] });
            return; // Command handled, no need to send to Gemini directly
        } else { // General message to Gemini
            if (!apiKey) {
                this.showSystemMessage(webview, "API key not set. Please set it in the extension settings.", this.currentHistory);
                webview.postMessage({ command: 'geminiResponse', sender: 'system', text: "API key not set.", history: [...this.currentHistory], isError: true });
                return;
            }
            if (!modelToUse) {
                this.showSystemMessage(webview, "Gemini model not set. Please check extension settings.", this.currentHistory);
                webview.postMessage({ command: 'geminiResponse', sender: 'system', text: "Gemini model not set.", history: [...this.currentHistory], isError: true });
                return;
            }

            // The user message is already added to currentHistory at the beginning of this function.
            // We need to construct the historyForGemini *before* this turn's user message for context injection.
            let historyForGeminiPromptConstruction: ChatMessage[] = [...this.currentHistory];
            
            // Remove the last user message if it's the current one, to inject context before it.
            if (historyForGeminiPromptConstruction.length > 0 &&
                historyForGeminiPromptConstruction[historyForGeminiPromptConstruction.length - 1].role === 'user' &&
                historyForGeminiPromptConstruction[historyForGeminiPromptConstruction.length - 1].parts[0].text === messageText) {
                historyForGeminiPromptConstruction = historyForGeminiPromptConstruction.slice(0, -1);
            }


            if (this.contextualContent.length > 0) {
                const contextPreambleMessages: ChatMessage[] = [];
                this.contextualContent.forEach(item => {
                    contextPreambleMessages.push({
                        role: 'user', // Priming Gemini with context as if user provided it
                        parts: [{ text: `IMPORTANT CONTEXT FILE: ${item.path}\nCONTENT:\n\`\`\`\n${item.content}\n\`\`\`` }]
                    });
                    contextPreambleMessages.push({
                        role: 'model', // Gemini acknowledges the context
                        parts: [{ text: `Acknowledged. The content of "${item.path}" is now part of my context for the subsequent query.` }]
                    });
                });
                // Prepend context to the history that Gemini will process for this turn
                historyForGeminiPromptConstruction.push(...contextPreambleMessages);
            }

            // Now add the actual current user message to this specially constructed history
            historyForGeminiPromptConstruction.push({ role: 'user', parts: [{ text: messageText }] });


            this.showSystemMessage(webview, "Gemini is thinking..."); // This system message is for UI, not for Gemini's history
            try {                
                // Use the historyForGeminiPromptConstruction for the API call
                const geminiResponseText = await this.geminiService.askGeminiWithHistory(historyForGeminiPromptConstruction);
                const geminiMessage: ChatMessage = { role: 'model', parts: [{ text: geminiResponseText }] };
                this.currentHistory.push(geminiMessage); // Add Gemini's actual response to the persistent history
                webview.postMessage({ command: 'geminiResponse', sender: 'gemini', text: geminiResponseText, history: [...this.currentHistory] });
            } catch (error: any) {
                const errorMessage = `Error calling Gemini: ${error.message || 'Unknown error'}`;
                // Add error indication to history for user, but maybe not for Gemini's next turn unless it's a Gemini fault
                const errorSystemMessage: ChatMessage = { role: 'model', parts: [{ text: `System: ${errorMessage}` }] };
                this.currentHistory.push(errorSystemMessage);
                console.error(errorMessage, error);
                webview.postMessage({ command: 'geminiResponse', sender: 'system', text: `Error: ${error.message}`, history: [...this.currentHistory], isError: true });
            }
        }
    }

    private ensureWorkspaceOpen(webview: vscode.Webview): boolean {
        if (!this.currentWorkspaceRoot) {
            this.showSystemMessage(webview, "No workspace folder is open. Please open a folder to use file system commands.", this.currentHistory);
            return false;
        }
        return true;
    }

    // _resolvePath, readFileContent, writeFileContent, ensureWorkspaceOpen are now in fileSystemUtils
    // and used by FileOperationCommands. If FileService itself needs them for other purposes (e.g. context management),
    // it should also import them from fileSystemUtils. For addPathToContext, it does.

    private async addPathToContext(rawPath: string, webview: vscode.Webview): Promise<void> {
        if (!this.ensureWorkspaceOpen(webview)) {
            return;
        }

        const workspaceRootUri = vscode.workspace.workspaceFolders![0].uri;
        let targetUri: vscode.Uri;
        let relativePath: string;

        try {
            const resolved = resolvePathUtil(rawPath, this.currentWorkspaceRoot, webview, this.showSystemMessage, this.currentHistory);
            if (!resolved) {
                return;
            }
            targetUri = resolved.uri;
            relativePath = resolved.relativePath;
        } catch (error: any) {
            // _resolvePath already calls showSystemMessage, but we add to history here if it throws
            this.showSystemMessage(webview, `Error resolving path for context: ${error.message}`, this.currentHistory);
            return;
        }

        try {
            const stat = await vscode.workspace.fs.stat(targetUri);
            let filesAddedCount = 0;
            let filesSkippedCount = 0;
            let filesUpdatedCount = 0;

            if (stat.type === vscode.FileType.File) {
                if (stat.size > MAX_FILE_SIZE_FOR_CONTEXT) {
                    this.showSystemMessage(webview, `File ${relativePath} is too large (${(stat.size / 1024).toFixed(2)}KB) to add to context. Max size is ${(MAX_FILE_SIZE_FOR_CONTEXT / 1024)}KB.`, this.currentHistory);
                    filesSkippedCount++;
                } else {
                    const content = await readFileContentUtil(targetUri); // Use util
                    const existingIndex = this.contextualContent.findIndex(c => c.path === relativePath);
                    if (existingIndex !== -1) {
                        this.contextualContent[existingIndex].content = content;
                        this.showSystemMessage(webview, `Updated context for: ${relativePath}`, this.currentHistory);
                        filesUpdatedCount++;
                    } else {
                        this.contextualContent.push({ path: relativePath, content });
                        this.showSystemMessage(webview, `Added to context: ${relativePath}`, this.currentHistory);
                        filesAddedCount++;
                    }
                }
            } else if (stat.type === vscode.FileType.Directory) {
                const entries = await vscode.workspace.fs.readDirectory(targetUri);
                let dirFilesAdded = 0;
                let dirFilesSkipped = 0;
                let dirFilesUpdated = 0;

                if (entries.length === 0) {
                    this.showSystemMessage(webview, `Directory ${relativePath} is empty. No files added to context.`, this.currentHistory);
                }

                for (const [name, type] of entries) {
                    if (type === vscode.FileType.File) {
                        const fileUriInDir = vscode.Uri.joinPath(targetUri, name);
                        // Construct relative path correctly for files in subdirectories
                        const fileRelativePath = path.join(relativePath === '.' ? '' : relativePath, name).replace(/\\/g, '/');
                        try {
                            const fileStat = await vscode.workspace.fs.stat(fileUriInDir);
                            if (fileStat.size > MAX_FILE_SIZE_FOR_CONTEXT) {
                                this.showSystemMessage(webview, `Skipped ${fileRelativePath} (in ${relativePath}) due to size > ${MAX_FILE_SIZE_FOR_CONTEXT / 1024}KB.`, this.currentHistory);
                                dirFilesSkipped++;
                                continue;
                            }
                            const content = await readFileContentUtil(fileUriInDir); // Use util
                            const existingIndex = this.contextualContent.findIndex(c => c.path === fileRelativePath);
                            if (existingIndex !== -1) {
                                this.contextualContent[existingIndex].content = content;
                                dirFilesUpdated++;
                            } else {
                                this.contextualContent.push({ path: fileRelativePath, content });
                                dirFilesAdded++;
                            }
                        } catch (e: any) {
                            this.showSystemMessage(webview, `Could not read file ${fileRelativePath} in directory ${relativePath}: ${e.message}`, this.currentHistory);
                            console.warn(`Could not read file ${fileRelativePath} in directory: ${e.message}`);
                        }
                    }
                }
                filesAddedCount += dirFilesAdded;
                filesSkippedCount += dirFilesSkipped;
                filesUpdatedCount += dirFilesUpdated;

                let message = "";
                if (dirFilesAdded > 0) {
                    message += `Added ${dirFilesAdded} new file(s) from ${relativePath}. `;
                }
                if (dirFilesUpdated > 0) {
                    message += `Updated ${dirFilesUpdated} existing file(s) in context from ${relativePath}. `;
                }
                if (dirFilesSkipped > 0) {
                    message += `Skipped ${dirFilesSkipped} file(s) from ${relativePath} due to size. `;
                }
                if (message) {
                    this.showSystemMessage(webview, message.trim(), this.currentHistory);
                } else if (entries.length > 0 && dirFilesAdded === 0 && dirFilesUpdated === 0 && dirFilesSkipped === 0) {
                     this.showSystemMessage(webview, `No applicable files found in directory ${relativePath} to add or update in context.`, this.currentHistory);
                }


            } else {
                this.showSystemMessage(webview, `Path ${relativePath} is not a file or directory.`, this.currentHistory);
                return;
            }

            if (filesAddedCount > 0 || filesSkippedCount > 0 || filesUpdatedCount > 0) {
                 this.showSystemMessage(webview, `Context now contains ${this.contextualContent.length} file(s).`, this.currentHistory);
            }
        } catch (error: any) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                this.showSystemMessage(webview, `Path not found: ${relativePath}`, this.currentHistory);
            } else {
                this.showSystemMessage(webview, `Error accessing path ${relativePath}: ${error.message}`, this.currentHistory);
            }
            console.error(`Error in addPathToContext for ${relativePath}:`, error);
        }
    }

    private async clearContext(webview: vscode.Webview): Promise<void> {
        this.contextualContent = [];
        this.showSystemMessage(webview, "Context has been cleared.", this.currentHistory);
    }

    private async listContext(webview: vscode.Webview): Promise<void> {
        if (this.contextualContent.length === 0) {
            this.showSystemMessage(webview, "Context is currently empty.", this.currentHistory);
            return;
        }
        const fileList = this.contextualContent.map(c => `- ${c.path} (${(c.content.length / 1024).toFixed(2)}KB)`).join('\n');
        this.showSystemMessage(webview, `Files currently in context:\n${fileList}\nTotal: ${this.contextualContent.length} file(s).`, this.currentHistory);
    }
}
