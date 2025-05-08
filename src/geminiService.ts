// c:\Users\marti\gemini-fs\src\geminiService.ts
import * as vscode from 'vscode';
import { GoogleGenerativeAI, GenerativeModel, Content, BlockReason } from '@google/generative-ai';

const API_KEY_SECRET_ID = 'geminiApiKey';

export class GeminiService {
    private context: vscode.ExtensionContext;
    private genAI: GoogleGenerativeAI | null = null;
    private model: GenerativeModel | null = null;
    private currentApiKey: string | undefined = undefined;
    private currentModelName: string | undefined = undefined;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadApiKeyFromSecrets().then(key => {
            if (key) {
                this.currentApiKey = key;
                this.initializeClient();
            }
        });
        this.loadModelConfiguration();

        // Listen for configuration changes
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('geminiFS.modelName')) {
                    this.loadModelConfiguration();
                }
            })
        );
        console.log("GeminiService instantiated.");
    }

    private async loadApiKeyFromSecrets(): Promise<string | undefined> {
        this.currentApiKey = await this.context.secrets.get(API_KEY_SECRET_ID);
        if (!this.currentApiKey) {
            // Fallback to environment variable if not in secrets
            this.currentApiKey = process.env.GEMINI_API_KEY;
            if (this.currentApiKey) {
                console.log("GeminiService: API Key loaded from environment variable.");
                // Optionally store it in secrets for future use
                // await this.context.secrets.store(API_KEY_SECRET_ID, this.currentApiKey);
            }
        } else {
            console.log("GeminiService: API Key loaded from VS Code secrets.");
        }
        return this.currentApiKey;
    }

    private loadModelConfiguration(): void {
        const config = vscode.workspace.getConfiguration('geminiFS');
        const newModelName = config.get<string>('modelName', 'gemini-pro'); // Default to gemini-pro
        if (this.currentModelName !== newModelName) {
            this.currentModelName = newModelName;
            console.log(`GeminiService: Model name configured to ${this.currentModelName}. Re-initializing client if API key exists.`);
            if (this.currentApiKey) {
                this.initializeClient(); // Re-initialize if model name changes and API key is present
            }
        }
    }

    public async setApiKey(apiKey: string): Promise<void> {
        if (!apiKey || apiKey.trim() === "") {
            vscode.window.showErrorMessage("API Key cannot be empty.");
            return;
        }
        this.currentApiKey = apiKey;
        await this.context.secrets.store(API_KEY_SECRET_ID, apiKey);
        console.log("GeminiService: API Key stored in VS Code secrets.");
        vscode.window.showInformationMessage('Gemini API Key saved successfully.');
        this.initializeClient(); // Re-initialize with the new key
    }

    public async getApiKey(): Promise<string | undefined> {
        if (!this.currentApiKey) {
            await this.loadApiKeyFromSecrets();
        }
        return this.currentApiKey;
    }

    private initializeClient(): void {
        if (!this.currentApiKey) {
            console.warn("GeminiService: Cannot initialize client, API key is missing.");
            // Do not show error message here, let operations that require it handle it.
            this.genAI = null;
            this.model = null;
            return;
        }
        if (!this.currentModelName) {
            console.warn("GeminiService: Cannot initialize client, model name is missing.");
            this.genAI = null;
            this.model = null;
            return;
        }

        try {
            this.genAI = new GoogleGenerativeAI(this.currentApiKey);
            this.model = this.genAI.getGenerativeModel({ model: this.currentModelName });
            console.log(`GeminiService: Client and model (${this.currentModelName}) initialized successfully.`);
        } catch (error) {
            console.error("GeminiService: Error initializing GoogleGenerativeAI client or model:", error);
            vscode.window.showErrorMessage(`Failed to initialize Gemini client: ${error instanceof Error ? error.message : String(error)}`);
            this.genAI = null;
            this.model = null;
        }
    }

    public async askGeminiWithHistory(
        history: Content[]
    ): Promise<string> {
        try {
            console.log("GeminiService: askGeminiWithHistory called. History length:", history.length, "Last user message (attempting to find):", history.length > 0 ? "yes" : "no");
            // No need to await initializeClient() here as it's synchronous in its current form
            // and operations that need the client check this.model.
            // However, if initializeClient were to become async for other reasons, awaiting it would be necessary.
            // For now, the check for this.model below handles the initialization state.

            if (!this.model) {
                // Attempt to get API key if model isn't initialized (might be missing key)
                const apiKey = await this.getApiKey(); // Ensure API key is loaded
                if (!apiKey) {
                     vscode.window.showErrorMessage("Gemini API Key is not set. Please set it using the 'Gemini FS: Set Gemini API Key' command.");
                     return "API Key not set. Please use the command 'Gemini FS: Set Gemini API Key'.";
                }
                // If API key exists, try initializing the client again.
                this.initializeClient();
                if (!this.model) {
                    // If still not initialized, then there was a persistent error.
                    throw new Error("Gemini model is not initialized. Check console for errors during client initialization.");
                }
            }

            // The prompt for sendMessage should be the latest user message.
            // The history array itself is passed to startChat.
            let lastUserMessageText: string | undefined = undefined;
            for (let i = history.length - 1; i >= 0; i--) {
                if (history[i].role === "user" && history[i].parts.length > 0) {
                    const textPart = history[i].parts.find(part => 'text' in part);
                    if (textPart && 'text' in textPart) {
                        lastUserMessageText = textPart.text;
                        break;
                    }
                }
            }
            
            console.log("GeminiService: Last user message found:", lastUserMessageText ? lastUserMessageText.substring(0,100) + "..." : "None");

            if (!lastUserMessageText) {
                console.warn("GeminiService: No user message found in history to send as prompt.");
                return "I need a message from you to respond!";
            }

            // Pass all history *except* the current user prompt to startChat
            // The current user prompt is the last element if it was just added.
            const historyForChatInitialization = history.filter(h => h.role !== "user" || h.parts[0].text !== lastUserMessageText);
            // A more robust way if multiple identical user messages could exist:
            // Find the index of the last user message and slice up to that.
            let lastUserMessageIndex = -1;
            for (let i = history.length - 1; i >= 0; i--) {
                 if (history[i].role === "user" && history[i].parts.length > 0 && history[i].parts[0].text === lastUserMessageText) {
                    lastUserMessageIndex = i;
                    break;
                }
            }
            const chatInitializationHistory = lastUserMessageIndex > -1 ? history.slice(0, lastUserMessageIndex) : history.slice(0, -1);


            const chat = this.model.startChat({ history: chatInitializationHistory });
            console.log("GeminiService: Chat started with history. Sending prompt to Gemini:", lastUserMessageText.substring(0,100) + "...");
            const result = await chat.sendMessage(lastUserMessageText);

            const response = result.response;
            if (response.promptFeedback?.blockReason) {
                const blockMessage = `Blocked: ${response.promptFeedback.blockReason}. ${response.promptFeedback.blockReasonMessage || ''}`;
                console.warn("GeminiService: Content blocked by API - ", blockMessage);
                vscode.window.showWarningMessage(`Gemini API: ${blockMessage}`);
                return `Your request was blocked by the API: ${response.promptFeedback.blockReason}. Please rephrase your prompt.`;
            }

            if (response.candidates && response.candidates.length > 0 && response.candidates[0].content && response.candidates[0].content.parts.length > 0) {
                const text = response.candidates[0].content.parts[0].text;
                if (text === undefined || text === null) {
                    console.warn("GeminiService: Received undefined or null text from Gemini.");
                    vscode.window.showWarningMessage("Gemini API: Received an empty response.");
                    return "Gemini returned an empty response.";
                }
                console.log("GeminiService: Successfully received response from Gemini:", text.substring(0,100) + "...");
                return text;
            } else {
                console.warn("GeminiService: No candidates found in Gemini response or response was empty.");
                vscode.window.showWarningMessage("Gemini API: No response candidates found.");
                return "Sorry, I could not get a response from Gemini at this time (no candidates).";
            }
        } catch (error) {
            console.error("GeminiService: Error in askGeminiWithHistory:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Gemini API Error: ${errorMessage}`);
            return `Sorry, an error occurred while contacting Gemini: ${errorMessage}`;
        }
    }
}
