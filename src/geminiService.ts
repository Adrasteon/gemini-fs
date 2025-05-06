import * as vscode from 'vscode';
import {
    GoogleGenerativeAI, // Use the main SDK entry point
    GenerativeModel,    // Type for the model instance
    GenerateContentRequest,
    Content, // Represents the conversation history format
    GenerateContentResponse,
    // Import other necessary types like HarmCategory, HarmBlockThreshold if needed
} from "@google/generative-ai"; // Ensure this package is installed and up-to-date

// Define a constant for the secret key
const GEMINI_API_KEY_SECRET_KEY = 'geminiApiKey';
// Define constants for configuration
const CONFIG_SECTION = 'geminiFS'; // Use your extension's ID from package.json
const CONFIG_MODEL_NAME = 'modelName';

/**
 * Service class to handle interactions with the Google Gemini API.
 */
export class GeminiService {
    // Store the main SDK entry point instance and the model instance
    private genAI: GoogleGenerativeAI | null = null;
    private model: GenerativeModel | null = null;
    private modelName: string = 'gemini-pro'; // Default model
    private context: vscode.ExtensionContext | undefined;

    /**
     * Initializes the service, optionally receiving the extension context
     * for accessing secrets and configuration.
     * @param context The VS Code extension context.
     */
    constructor(context?: vscode.ExtensionContext) {
        this.context = context;
        // Read initial configuration
        this.updateModelFromConfiguration();

        // Listen for configuration changes if context is available
        if (this.context) {
            this.context.subscriptions.push(
                vscode.workspace.onDidChangeConfiguration(e => {
                    if (e.affectsConfiguration(`${CONFIG_SECTION}.${CONFIG_MODEL_NAME}`)) {
                        console.log("Gemini model configuration changed, updating...");
                        this.updateModelFromConfiguration(); // This will handle re-initializing the model
                    }
                })
            );
        } else {
            console.warn("GeminiService initialized without ExtensionContext. Secret storage and configuration listening will be unavailable.");
        }
    }

    /**
     * Updates the model name based on the current VS Code configuration
     * and re-initializes the model instance if needed.
     */
    private updateModelFromConfiguration(): void {
        try {
            const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
            const newModelName = config.get<string>(CONFIG_MODEL_NAME, 'gemini-pro'); // Get setting, provide default
            if (newModelName !== this.modelName) {
                 this.modelName = newModelName;
                 console.log(`Updating Gemini model to: ${this.modelName}`);
                 // Re-initialize the model part if the main client (genAI) is already set up
                 if (this.genAI) {
                     try {
                        this.model = this.genAI.getGenerativeModel({ model: this.modelName });
                        console.log(`Gemini model instance updated to: ${this.modelName}`);
                     } catch (modelError) {
                         console.error(`Failed to get model instance for ${this.modelName}:`, modelError);
                         vscode.window.showErrorMessage(`Failed to switch to model ${this.modelName}. Please check configuration.`);
                         this.model = null; // Force re-init on next call
                     }
                 } else {
                     console.log(`Model name set to ${this.modelName}. Client will initialize with this model.`);
                 }
            } else {
                 console.log(`Using Gemini model: ${this.modelName}`);
            }
        } catch (error) {
            console.error("Error reading model configuration:", error);
            // Keep the default modelName if configuration reading fails
        }
    }

    /**
     * Lazily initializes the Gemini API client and model instance.
     * Prioritizes API key from VS Code secrets, then environment variable.
     * Throws an error if the API key is not configured.
     */
    private async initializeClient(): Promise<void> { // Renamed for clarity
        // Check if already initialized
        if (this.genAI && this.model) {
            return;
        }

        let apiKey: string | undefined = undefined;

        // 1. Attempt to get from secrets if context is available
        if (this.context) {
            try {
                apiKey = await this.context.secrets.get(GEMINI_API_KEY_SECRET_KEY);
                if (apiKey) {
                    console.log("Retrieved API key from VS Code secrets.");
                } else {
                     console.log("No API key found in VS Code secrets.");
                }
            } catch (secretError) {
                console.error("Error retrieving API key from secrets:", secretError);
                // Fall through to try environment variable
            }
        }

        // 2. Fall back to environment variable if not found in secrets
        if (!apiKey) {
            apiKey = process.env.GEMINI_API_KEY;
            if (apiKey) {
                console.log("Using API key from environment variable (GEMINI_API_KEY).");
            }
        }

        // 3. Check if an API key was found
        if (!apiKey) {
            const errorMsg = `Gemini API key is not configured. Please set it using the 'Set Gemini API Key' command or the GEMINI_API_KEY environment variable.`;
            // Show error to user and throw
            vscode.window.showErrorMessage(errorMsg);
            throw new Error(errorMsg);
        }

        // 4. Initialize the main SDK entry point and get the model
        try {
            this.genAI = new GoogleGenerativeAI(apiKey);
            this.model = this.genAI.getGenerativeModel({ model: this.modelName });
            console.log(`Gemini client initialized successfully for model: ${this.modelName}`);
        } catch (initError) {
            const errorMessage = initError instanceof Error ? initError.message : String(initError);
            console.error("Failed to initialize Gemini client:", initError);
            // Reset potentially partially initialized state
            this.genAI = null;
            this.model = null;
            vscode.window.showErrorMessage(`Failed to initialize Gemini client: ${errorMessage}`);
            throw new Error(`Failed to initialize Gemini client: ${errorMessage}`);
        }
    }

    /**
     * Sends the conversation history to the Gemini API and returns the response.
     * Handles potential API errors and blocked responses.
     * @param history The conversation history, alternating user/model roles.
     * @returns The text response from the model.
     * @throws An error if the API call fails, is blocked, or returns no valid response.
     */
    public async askGeminiWithHistory(history: Content[]): Promise<string> {
        if (!history || history.length === 0) {
            throw new Error("Conversation history cannot be empty.");
        }

        // Ensure client and model are initialized
        await this.initializeClient();
        if (!this.model) {
             // initializeClient should throw, but double-check
             throw new Error("Gemini model instance is not available.");
        }

        const request: GenerateContentRequest = {
            // model: this.modelName, // Model name is part of getting the model instance now
            contents: history,
            // Add generationConfig if needed (temperature, topP, etc.)
            // generationConfig: { temperature: 0.7, topP: 1.0 }
            // Add safetySettings if needed
            // safetySettings: [...]
        };

        try {
            console.log(`Sending request to Gemini model: ${this.modelName}`);
            // Use the model instance to generate content
            const result = await this.model.generateContent(request); // Adjust based on SDK docs if needed
            // --- Robust Response Handling ---
            const response = result.response; // Access the response part of the result

            // Check for safety blocks or other reasons for no candidates
            if (!response.candidates || response.candidates.length === 0) {
                const blockReason = response.promptFeedback?.blockReason;
                if (blockReason) {
                    const blockMessage = `Request blocked by Gemini due to: ${blockReason}.`;
                    console.warn(blockMessage, response.promptFeedback);
                    vscode.window.showWarningMessage(blockMessage); // Inform user
                    throw new Error(blockMessage); // Throw to signal failure
                } else {
                    const noCandidateMsg = "Gemini returned no response candidates.";
                    console.warn(noCandidateMsg, response);
                    vscode.window.showWarningMessage(noCandidateMsg);
                    throw new Error(noCandidateMsg);
                }
            }

            // Extract text from the first candidate (assuming it's the primary one)
            // The structure might vary, adjust if needed based on API documentation
            const firstCandidate = response.candidates[0];
            // Use helper function for safer access
            const responseText = this.extractTextFromCandidate(firstCandidate);

            if (typeof responseText !== 'string') {
                 const noTextMsg = "No valid response text found in the first candidate.";
                 console.warn(noTextMsg, firstCandidate);
                 throw new Error(noTextMsg);
            }

            console.log("Received valid response text from Gemini.");
            return responseText;

        } catch (apiError) {
            // Catch errors from the API call itself or from our checks above
            const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
            console.error("Gemini API Error:", apiError);
            // Avoid showing redundant error messages if we already showed one (e.g., for blocked content)
            if (!errorMessage.startsWith("Request blocked by Gemini") && !errorMessage.includes("no response candidates")) {
                 vscode.window.showErrorMessage(`Gemini API Error: ${errorMessage}`);
            }
            // Re-throw the error so the caller knows the operation failed
            throw new Error(`Gemini API Error: ${errorMessage}`);
        }
    }

    // Helper to safely extract text
    private extractTextFromCandidate(candidate: any): string | null {
         // Add more checks if the structure can vary further
         if (candidate?.content?.parts?.[0]?.text) {
             return candidate.content.parts[0].text;
         }
         return null;
    }

    /**
     * Allows setting the API key securely using VS Code's SecretStorage.
     * Should be called from a command registered in extension.ts.
     * @param apiKey The API key provided by the user.
     */
    public async setApiKey(apiKey: string): Promise<void> {
        if (!this.context) {
            const errorMsg = "Extension context is not available. Cannot save API key securely.";
            console.error(errorMsg);
            vscode.window.showErrorMessage(errorMsg);
            return;
        }
        if (!apiKey) {
             vscode.window.showWarningMessage("Cannot set an empty API key.");
             return;
        }

        try {
            await this.context.secrets.store(GEMINI_API_KEY_SECRET_KEY, apiKey);
            // Force re-initialization on the next API call
            this.genAI = null;
            this.model = null;
            vscode.window.showInformationMessage("Gemini API key stored securely. It will be used on the next request.");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Failed to store Gemini API key:", error);
            vscode.window.showErrorMessage(`Failed to store API key: ${errorMessage}`);
        }
    }

    /**
     * Retrieves the currently stored API key from VS Code's SecretStorage.
     * This is primarily for UI purposes (e.g., letting the webview know if a key is set).
     * @returns The API key string if found, otherwise undefined.
     */
    public async getApiKey(): Promise<string | undefined> {
        if (!this.context) {
            console.warn("Extension context is not available in GeminiService. Cannot retrieve API key.");
            // Optionally, show a less intrusive message or just log,
            // as this might be called by UI elements just checking status.
            // vscode.window.showWarningMessage("Cannot check API key status: Extension context unavailable.");
            return undefined;
        }
        try {
            const apiKey = await this.context.secrets.get(GEMINI_API_KEY_SECRET_KEY);
            return apiKey;
        } catch (error) {
            console.error("Failed to retrieve Gemini API key from secrets:", error);
            return undefined;
        }
    }
}
