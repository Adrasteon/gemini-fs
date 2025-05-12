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

        const fileService = new FileService({ geminiService });
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
                            vscode.Uri.joinPath(context.extensionUri, 'src', 'webview') // For CSS, HTML template, and libraries
                        ],
                        retainContextWhenHidden: true // Optional: keep webview alive
                    }
                );

                console.log('gemini-fs: Webview panel created');

                // Get URIs for webview resources
                const scriptPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'out', 'webview.js');
                const scriptUri = panel.webview.asWebviewUri(scriptPathOnDisk);
   
                // Assuming style.css is directly used from src/webview and not part of the esbuild process for webview.js
                const stylePathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'style.css');
                const styleUri = panel.webview.asWebviewUri(stylePathOnDisk);
   
                // URI for the diff library
                //const diffLibPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'lib', 'diff.min.js');
                //const diffLibUri = panel.webview.asWebviewUri(diffLibPathOnDisk);

                // Generate a nonce for CSP
                const nonce = getNonce();

                const htmlPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'main.html');
                let htmlContent = fs.readFileSync(htmlPathOnDisk.fsPath, 'utf8');

                // Replace placeholders in HTML
                htmlContent = htmlContent.replace(/\${cspSource}/g, panel.webview.cspSource);
                htmlContent = htmlContent.replace(/\${nonce}/g, nonce);
                htmlContent = htmlContent.replace('${scriptUri}', scriptUri.toString());
                //htmlContent = htmlContent.replace('${diffLibUri}', diffLibUri.toString());
                htmlContent = htmlContent.replace('${styleUri}', styleUri.toString());

                console.log('gemini-fs: HTML content prepared');
                panel.webview.html = htmlContent;

                // Handle messages from the webview
                panel.webview.onDidReceiveMessage(
                    async message => {
                        // It's good practice to fetch API key and model name once if multiple cases might need them.
                        // However, for 'getApiKey', it's fetched specifically.
                        // For other actions involving FileService, we'll fetch them as needed or pass them down.

                        switch (message.command) {
                            case 'getApiKey':
                                console.log('gemini-fs: Webview requested API key');
                                const currentApiKey = await geminiService.getApiKey();
                                console.log('[Extension.ts] Value from geminiService.getApiKey() for webview:', currentApiKey ? `Exists (ends with ...${currentApiKey.slice(-4)})` : `Not set/Empty`, `(Raw: "${currentApiKey}")`);
                                panel.webview.postMessage({ command: 'apiKey', key: currentApiKey });
                                return;

                            case 'sendToGemini':
                            case 'confirmCreate':
                            case 'confirmWrite':
                            case 'confirmDelete':
                                console.log('gemini-fs: Message from webview to Gemini:', message.text);
                                const apiKey = await geminiService.getApiKey();
                                console.log('[Extension.ts] Value from geminiService.getApiKey() for FileService:', apiKey ? `Exists (ends with ...${apiKey.slice(-4)})` : `Not set/Empty`, `(Raw: "${apiKey}")`);
                                const modelName = vscode.workspace.getConfiguration('geminiFS').get<string>('modelName', 'gemini-1.5-flash-latest');

                                let payloadForFileService: any = undefined;
                                let messageTextForFileService = message.text;

                                if (message.command === 'confirmCreate') {
                                    console.log('gemini-fs: Webview confirmed file creation for:', message.filePath);
                                    if (message.filePath && typeof message.proposedContent === 'string') {
                                        payloadForFileService = { command: 'confirmCreateFile', filePath: message.filePath, content: message.proposedContent };
                                        messageTextForFileService = ''; // No text needed when payload command is present
                                    } else {
                                        console.error('gemini-fs: Invalid payload for confirmCreate', message);
                                        panel.webview.postMessage({ command: 'geminiResponse', sender: 'system', text: 'Invalid data received for file creation.', isError: true });
                                        return;
                                    }
                                } else if (message.command === 'confirmWrite') {
                                    console.log('gemini-fs: Webview confirmed file write for:', message.filePath);
                                    if (message.filePath && typeof message.proposedContent === 'string') {
                                        payloadForFileService = { command: 'confirmWriteFile', filePath: message.filePath, newContent: message.proposedContent };
                                        messageTextForFileService = ''; // No text needed
                                    } else {
                                        console.error('gemini-fs: Invalid payload for confirmWrite', message);
                                        panel.webview.postMessage({ command: 'geminiResponse', sender: 'system', text: 'Invalid data received for file modification.', isError: true });
                                        return;
                                    }
                                } else if (message.command === 'confirmDelete') {
                                    console.log('gemini-fs: Webview confirmed file deletion for:', message.filePath);
                                    if (message.filePath) {
                                        payloadForFileService = { command: 'confirmDeleteFile', filePath: message.filePath };
                                        messageTextForFileService = ''; // No text needed
                                    } else {
                                        console.error('gemini-fs: Invalid payload for confirmDelete', message);
                                        panel.webview.postMessage({ command: 'geminiResponse', sender: 'system', text: 'Invalid data received for file deletion.', isError: true });
                                        return;
                                    }
                                }
                                await fileService.handleChatMessage(messageTextForFileService, panel.webview, apiKey as string, modelName as string, payloadForFileService || message.payload);
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
