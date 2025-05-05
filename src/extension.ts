// c:\Users\marti\Gemini_VSCode_Extension\gemini-fs\src\extension.ts
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs'; // Node's fs for reading HTML template initially
// Import your services
import { GeminiService } from './geminiService';
import { FileService } from './fileService';
// Import the Content type from the SDK if needed for history typing
import type { Content } from "@google/generative-ai";

// Helper function to get the workspace root URI
function getWorkspaceRootUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

// Helper function to resolve a potentially relative path against the workspace root
function resolvePath(inputPath: string): vscode.Uri | null {
    const workspaceRootUri = getWorkspaceRootUri();
    if (!workspaceRootUri) {
        vscode.window.showErrorMessage("Please open a folder or workspace to use file commands.");
        return null;
    }

    // Check if the path is already absolute (less common for user input)
    if (path.isAbsolute(inputPath)) {
        // Be cautious with absolute paths outside the workspace for security
        // For simplicity here, we allow it but convert to URI
        // In production, you might want to restrict this further.
        try {
            return vscode.Uri.file(inputPath);
        } catch (e) {
            vscode.window.showErrorMessage(`Invalid absolute path: ${inputPath}`);
            return null;
        }
    }

    // Assume relative path, join with workspace root
    return vscode.Uri.joinPath(workspaceRootUri, inputPath);
}

// Basic regex to find markdown code blocks
const CODE_BLOCK_REGEX = /```(?:\w*\n)?([\s\S]*?)```/g; // Non-greedy match

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "gemini-fs" is now active!');

    // Instantiate services, passing the context to GeminiService
    const geminiService = new GeminiService(context);
    const fileService = new FileService();

    let chatPanel: vscode.WebviewPanel | undefined = undefined;
    let conversationHistory: Content[] = []; // Use Content type for history
    let lastReadFileUri: vscode.Uri | null = null; // Track the last file read for context

    // --- Register Commands ---

    // Command to start the chat panel
    const startChatCommand = vscode.commands.registerCommand('gemini-fs.startChat', () => {
        const columnToShowIn = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it.
        if (chatPanel) {
            chatPanel.reveal(columnToShowIn);
            return;
        }

        // Otherwise, create a new panel.
        chatPanel = vscode.window.createWebviewPanel(
            'geminiChat', // Identifies the type of the webview. Used internally
            'Gemini FS Chat', // Title of the panel displayed to the user
            columnToShowIn || vscode.ViewColumn.One, // Editor column to show the new webview panel in.
            {
                // Enable javascript in the webview
                enableScripts: true,
                // Restrict the webview to only loading content from our extension's output directory and webview source dir
                localResourceRoots: [
                    vscode.Uri.joinPath(context.extensionUri, 'out'),
                    vscode.Uri.joinPath(context.extensionUri, 'src', 'webview')
                ]
            }
        );

        // Set the webview's initial html content
        chatPanel.webview.html = getWebviewContent(context, chatPanel.webview);

        // Handle messages from the webview
        chatPanel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'userMessage': { // Use block scope for clarity
                        const userText = message.text;
                        let fileUri: vscode.Uri | null = null;
                        let promptText = userText; // Text to actually send to Gemini
                        lastReadFileUri = null; // Reset last read file unless /read is used

                        // --- User Command Parsing ---
                        if (userText.toLowerCase().startsWith('/read ')) {
                            const filePath = userText.substring(6).trim();
                            if (!filePath) {
                                chatPanel?.webview.postMessage({ type: 'error', text: "Error: Please provide a file path after /read." });
                                return; // Don't proceed
                            }
                            fileUri = resolvePath(filePath);
                            if (!fileUri) {
                                // Error message shown by resolvePath
                                return;
                            }

                            try {
                                const fileContent = await fileService.readFile(fileUri);
                                // Modify the prompt to include file context
                                promptText = `Context from ${path.basename(fileUri.fsPath)}:\n\`\`\`\n${fileContent}\n\`\`\`\n\nUser request: ${userText}`;
                                // Store the URI for potential write operations later
                                lastReadFileUri = fileUri;
                                // Add original user message to history for context
                                conversationHistory.push({ role: 'user', parts: [{ text: userText }] });
                                // Add a system/context message (optional, adjust role if needed)
                                // conversationHistory.push({ role: 'system', parts: [{ text: `Reading file: ${fileUri.fsPath}` }] });
                                chatPanel?.webview.postMessage({ type: 'info', text: `Reading file: ${fileUri.fsPath}` });

                            } catch (error: any) {
                                console.error(`Error reading file for /read command:`, error);
                                chatPanel?.webview.postMessage({ type: 'error', text: `Error reading file ${filePath}: ${error.message}` });
                                return; // Don't proceed if file reading failed
                            }
                        } else {
                            // Regular message, add directly to history
                            conversationHistory.push({ role: 'user', parts: [{ text: userText }] });
                        }

                        // --- Call Gemini ---
                        try {
                            const geminiResponseText = await geminiService.askGeminiWithHistory(conversationHistory);
                            conversationHistory.push({ role: 'model', parts: [{ text: geminiResponseText }] });

                            // --- Gemini Response Parsing & File Actions ---
                            let proposedContent: string | null = null;
                            const codeBlocks = [...geminiResponseText.matchAll(CODE_BLOCK_REGEX)];

                            if (codeBlocks.length > 0) {
                                // Assume the first code block is the primary content suggestion
                                proposedContent = codeBlocks[0][1].trim();
                                console.log("Found potential code block in response.");
                            }

                            // If we have proposed content AND we read a file in the last user turn, offer to diff/write
                            if (proposedContent && lastReadFileUri) {
                                console.log(`Proposing changes for ${lastReadFileUri.fsPath}`);
                                try {
                                    // Show diff first
                                    await fileService.showDiff(lastReadFileUri, proposedContent);

                                    // Send message to webview asking for confirmation
                                    chatPanel?.webview.postMessage({
                                        type: 'confirmFileWrite',
                                        filePath: lastReadFileUri.fsPath, // Send fsPath for display
                                        proposedContent: proposedContent, // Send content needed for apply
                                        originalUri: lastReadFileUri.toString() // Send URI for identification
                                    });
                                    // Also send the textual response to the chat
                                    chatPanel?.webview.postMessage({ type: 'botMessage', text: geminiResponseText });
                                    // Don't write the file yet, wait for confirmation message

                                } catch (diffError: any) {
                                    console.error("Error showing diff:", diffError);
                                    chatPanel?.webview.postMessage({ type: 'error', text: `Could not show diff: ${diffError.message}` });
                                    // Still send the raw text response
                                    chatPanel?.webview.postMessage({ type: 'botMessage', text: geminiResponseText });
                                }
                            } else {
                                // No code block found or no file context, just send the text response
                                chatPanel?.webview.postMessage({ type: 'botMessage', text: geminiResponseText });
                            }

                        } catch (error: any) {
                            console.error("Error processing user message or calling Gemini:", error);
                            // Error message might have been shown by geminiService, but ensure one is sent to webview
                            chatPanel?.webview.postMessage({ type: 'error', text: `Error: ${error.message}` });
                            // Optionally remove the last user message from history if the API call failed
                            // if (conversationHistory.length > 0 && conversationHistory[conversationHistory.length - 1].role === 'user') {
                            //     conversationHistory.pop();
                            // }
                        }
                        return; // End userMessage case
                    } // End block scope for userMessage

                    case 'applyFileWrite': { // Handle confirmation from webview
                        const { originalUri, confirmedContent } = message;
                        if (!originalUri || typeof confirmedContent !== 'string') {
                             console.error("Invalid applyFileWrite message received:", message);
                             chatPanel?.webview.postMessage({ type: 'error', text: "Internal error: Invalid confirmation data." });
                             return;
                        }
                        const fileUriToWrite = vscode.Uri.parse(originalUri); // Convert string URI back to Uri object
                        console.log(`Applying changes to ${fileUriToWrite.fsPath}`);
                        try {
                            // Use WorkspaceEdit for better integration (undo, dirty state)
                            const edit = await fileService.createReplaceFileContentEdit(fileUriToWrite, confirmedContent); // Now requires await
                            const success = await fileService.applyWorkspaceEdit(edit);
                            if (success) {
                                chatPanel?.webview.postMessage({ type: 'info', text: `Changes applied to ${path.basename(fileUriToWrite.fsPath)}.` });
                            } else {
                                // Error message shown by applyWorkspaceEdit
                                chatPanel?.webview.postMessage({ type: 'error', text: `Failed to apply changes to ${path.basename(fileUriToWrite.fsPath)}.` });
                            }
                        } catch (writeError: any) {
                            console.error(`Error applying workspace edit for ${fileUriToWrite.fsPath}:`, writeError);
                            chatPanel?.webview.postMessage({ type: 'error', text: `Failed to write file ${path.basename(fileUriToWrite.fsPath)}: ${writeError.message}` });
                        }
                        return;
                    }

                    case 'discardFileWrite': { // Handle discard from webview
                         const { originalUri } = message;
                         if (originalUri) {
                             const discardedFileUri = vscode.Uri.parse(originalUri);
                             console.log(`Discarding proposed changes for ${discardedFileUri.fsPath}`);
                             chatPanel?.webview.postMessage({ type: 'info', text: `Changes discarded for ${path.basename(discardedFileUri.fsPath)}.` });
                         }
                         return;
                    }
                }
            },
            undefined,
            context.subscriptions
        );

        // Reset panel variable and history when closed
        chatPanel.onDidDispose(
            () => {
                chatPanel = undefined;
                conversationHistory = []; // Clear history
                lastReadFileUri = null; // Clear file context
                console.log("Gemini chat panel disposed.");
            },
            null,
            context.subscriptions
        );
    });

    // Command to set the API Key
    const setApiKeyCommand = vscode.commands.registerCommand('gemini-fs.setApiKey', async () => {
        const apiKey = await vscode.window.showInputBox({
            prompt: "Enter your Google AI Studio API Key",
            password: true, // Mask the input
            ignoreFocusOut: true, // Keep input box open even if focus moves
            validateInput: text => {
                return text && text.trim().length > 0 ? null : 'API Key cannot be empty.';
            }
        });

        if (apiKey) {
            await geminiService.setApiKey(apiKey); // Use the service method
        } else {
            vscode.window.showWarningMessage("API Key was not entered.");
        }
    });

    // Add commands to the subscriptions for cleanup
    context.subscriptions.push(startChatCommand, setApiKeyCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}

// Helper function to get the HTML content for the webview
function getWebviewContent(context: vscode.ExtensionContext, webview: vscode.Webview): string {
    const htmlPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'main.html');
    // --- Point to the webview script in the 'src/webview' directory ---
    const scriptPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'script.js');
    const stylePathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'style.css');

    // Convert to URIs usable in the webview
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk);
    const styleUri = webview.asWebviewUri(stylePathOnDisk);

    try {
        let htmlContent = fs.readFileSync(htmlPathOnDisk.fsPath, 'utf8');
        const nonce = getNonce();
        // Replace placeholders in the HTML template
        htmlContent = htmlContent.replace(/\${styleUri}/g, styleUri.toString());
        htmlContent = htmlContent.replace(/\${scriptUri}/g, scriptUri.toString());
        htmlContent = htmlContent.replace(/\${nonce}/g, nonce);
        htmlContent = htmlContent.replace(/\${webview.cspSource}/g, webview.cspSource);
        return htmlContent;
    } catch (err) {
        console.error("Error reading or processing webview HTML file:", err);
        return `<html><body>Error loading webview content. Please check console. Path: ${htmlPathOnDisk.fsPath}</body></html>`;
    }
}

// Basic nonce generator
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
