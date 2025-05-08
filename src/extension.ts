// c:\Users\marti\gemini-fs\src\extension.ts
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path'; // Added for path operations
import { GeminiService } from './geminiService';
import { FileService } from './fileService';

export function activate(context: vscode.ExtensionContext) {
    try {
        console.log('gemini-fs: activate function CALLED');

        const geminiService = new GeminiService(context);
        console.log('gemini-fs: GeminiService instantiated');

        const fileService = new FileService(context, geminiService);
        console.log('gemini-fs: FileService instantiated');

        console.log('Congratulations, your extension "gemini-fs" is now active!');

        context.subscriptions.push(
            vscode.commands.registerCommand('gemini-fs.setApiKey', async () => {
                console.log('gemini-fs: setApiKey command triggered');
                try {
                    const apiKeyInput = await vscode.window.showInputBox({ prompt: 'Enter your Google AI Studio API Key' });
                    if (apiKeyInput) {
                        // No need to update globalState here, GeminiService handles secret storage
                        await geminiService.setApiKey(apiKeyInput);
                        // vscode.window.showInformationMessage('Gemini API Key saved.'); // setApiKey in service shows this
                    }
                } catch (error) {
                    console.error("Error in setApiKey command:", error);
                    vscode.window.showErrorMessage("Failed to set API key. See console for details.");
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('gemini-fs.startChat', () => {
                console.log('gemini-fs: startChat command triggered');
                const panel = vscode.window.createWebviewPanel(
                    'geminiFsChat',
                    'Gemini FS Chat',
                    vscode.ViewColumn.Beside,
                    {
                        enableScripts: true, // Enable scripts in the webview
                        localResourceRoots: [
                            vscode.Uri.joinPath(context.extensionUri, 'out'), // For compiled JS
                            vscode.Uri.joinPath(context.extensionUri, 'src', 'webview') // For CSS and HTML template
                        ]
                    }
                );

                console.log('gemini-fs: Webview panel created');

                // Get URIs for webview resources
                const scriptPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'out', 'webview.js');
                const scriptUri = panel.webview.asWebviewUri(scriptPathOnDisk);

                // Assuming style.css is directly used from src/webview and not part of the esbuild process for webview.js
                const stylePathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'style.css');
                const styleUri = panel.webview.asWebviewUri(stylePathOnDisk);

                // Generate a nonce for CSP
                const nonce = getNonce();

                const htmlPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'main.html');
                let htmlContent = fs.readFileSync(htmlPathOnDisk.fsPath, 'utf8');

                // Replace placeholders in HTML
                htmlContent = htmlContent.replace(/\${cspSource}/g, panel.webview.cspSource);
                htmlContent = htmlContent.replace(/\${nonce}/g, nonce);
                htmlContent = htmlContent.replace('${scriptUri}', scriptUri.toString());
                htmlContent = htmlContent.replace('${styleUri}', styleUri.toString());

                console.log('gemini-fs: HTML content prepared');
                panel.webview.html = htmlContent;

                // Handle messages from the webview
                panel.webview.onDidReceiveMessage(
                    async message => {
                        switch (message.command) {
                            case 'getApiKey':
                                console.log('gemini-fs: Webview requested API key');
                                const currentApiKey = await geminiService.getApiKey();
                                panel.webview.postMessage({ command: 'apiKey', key: currentApiKey });
                                return;
                            case 'sendToGemini':
                                console.log('gemini-fs: Message from webview to Gemini:', message.text);
                                await fileService.handleChatMessage(message.text, panel.webview);
                                return;
                            // New cases for handling confirmed file operations from webview
                            case 'confirmCreate':
                                console.log('gemini-fs: Webview confirmed file creation for:', message.filePath);
                                if (message.filePath && typeof message.proposedContent === 'string') {
                                    await fileService.performConfirmedCreate(message.filePath, message.proposedContent, panel.webview);
                                } else {
                                    console.error('gemini-fs: Invalid payload for confirmCreate', message);
                                    panel.webview.postMessage({ command: 'error', sender: 'system', text: 'Invalid data received for file creation.' });
                                }
                                return;
                            case 'confirmWrite':
                                console.log('gemini-fs: Webview confirmed file write for:', message.filePath);
                                if (message.filePath && typeof message.proposedContent === 'string') {
                                    await fileService.performConfirmedWrite(message.filePath, message.proposedContent, panel.webview);
                                } else {
                                    console.error('gemini-fs: Invalid payload for confirmWrite', message);
                                    panel.webview.postMessage({ command: 'error', sender: 'system', text: 'Invalid data received for file modification.' });
                                }
                                return;
                            case 'confirmDelete':
                                console.log('gemini-fs: Webview confirmed file deletion for:', message.filePath);
                                if (message.filePath) {
                                    await fileService.performConfirmedDelete(message.filePath, panel.webview);
                                } else {
                                    console.error('gemini-fs: Invalid payload for confirmDelete', message);
                                    panel.webview.postMessage({ command: 'error', sender: 'system', text: 'Invalid data received for file deletion.' });
                                }
                                return;
                            // Case for when user discards changes from a preview in the webview
                            case 'discardChanges': // This command might be sent by webview if user clicks "Discard"
                                console.log('gemini-fs: Webview requested to discard changes for file preview:', message.filePath);
                                // Inform the user in the webview that the action was cancelled.
                                // FileService doesn't need to do anything here as no FS operation was pending for confirmation.
                                panel.webview.postMessage({ command: 'geminiResponse', sender: 'system', text: `Changes discarded for ${message.filePath}. No action taken.` });
                                return;
                            default:
                                console.warn('gemini-fs: Received unknown command from webview:', message.command);
                        }
                    },
                    undefined,
                    context.subscriptions
                );

                panel.onDidDispose(() => {
                    console.log('gemini-fs: Webview panel disposed');
                    // Clean up resources when the panel is closed
                    // (e.g., if you had specific listeners or states tied to this panel instance)
                }, null, context.subscriptions);
            })
        );
    } catch (error) {
        console.error("CRITICAL ERROR during gemini-fs activation:", error);
        vscode.window.showErrorMessage("Gemini FS extension failed to activate. See Developer Tools console for details.");
    }
}

// Helper function to generate a nonce
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
// This method is called when your extension is deactivated
export function deactivate() {
    console.log('gemini-fs: Extension "gemini-fs" is now deactivated.');
}
