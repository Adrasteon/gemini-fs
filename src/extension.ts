import * as vscode from 'vscode';
import * as fs from 'fs';
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
                        enableScripts: true,
                        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'src', 'webview')]
                    }
                );

                console.log('gemini-fs: Webview panel created');
                // Get path to script.js in the webview
                const scriptPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'script.js');
                const scriptUri = panel.webview.asWebviewUri(scriptPathOnDisk);

                const htmlPathOnDisk = vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'main.html');
                let htmlContent = fs.readFileSync(htmlPathOnDisk.fsPath, 'utf8');
                htmlContent = htmlContent.replace('${scriptUri}', scriptUri.toString());
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
                            case 'applyChanges':
                                console.log('gemini-fs: Webview requested to apply changes');
                                await fileService.applyChanges(message.filePath, message.newContent);
                                panel.webview.postMessage({ command: 'changesApplied', filePath: message.filePath });
                                return;
                            case 'discardChanges':
                                console.log('gemini-fs: Webview requested to discard changes');
                                // Currently, discardChanges in the webview just clears the preview.
                                // If there's backend state to reset for a discarded change, handle it here.
                                panel.webview.postMessage({ command: 'changesDiscarded', filePath: message.filePath });
                                return;
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

// This method is called when your extension is deactivated
export function deactivate() {
    console.log('gemini-fs: Extension "gemini-fs" is now deactivated.');
}
