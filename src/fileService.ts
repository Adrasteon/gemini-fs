import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';

/**
 * Service class for handling file system operations within the VS Code workspace.
 */
export class FileService {

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
                // Depending on requirements, you might want to return null or an empty string here
                // instead of throwing, but throwing is often clearer for the caller.
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
            // Consider adding options like create: true, overwrite: true if needed explicitly
            await vscode.workspace.fs.writeFile(fileUri, writeData);
            if (options.showUserMessages) {
                console.log(`Successfully wrote to ${fileUri.fsPath}`);
                // Optionally show a success message, though often not necessary
                // vscode.window.showInformationMessage(`File saved: ${fileUri.fsPath}`);
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
        // Create a more unique filename
        const tempFileName = `${prefix}${Date.now()}-${Math.random().toString(36).substring(2, 8)}.tmp`;
        const tempFilePath = path.join(tempDir, tempFileName);
        const tempFileUri = vscode.Uri.file(tempFilePath);

        // Write the file, but suppress user messages as this is an internal operation
        // Errors will still be thrown upwards if writing fails.
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
            // Create a temporary file for the proposed content
            const proposedTempUri = await this.createTemporaryFile(proposedContent, `proposed-${path.basename(originalFileUri.fsPath)}-`);

            const diffTitle = title || `Diff: ${path.basename(originalFileUri.fsPath)}`;

            // Execute the built-in VS Code diff command
            await vscode.commands.executeCommand('vscode.diff', originalFileUri, proposedTempUri, diffTitle);

            // Note: Temporary file cleanup is still omitted for simplicity.
            // Consider implementing a cleanup strategy for production extensions.

        } catch (error) {
            // Catch errors specifically from createTemporaryFile or executeCommand
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`Error showing diff for ${originalFileUri.fsPath}:`, error);
            vscode.window.showErrorMessage(`Failed to show diff: ${errorMessage}`);
            // Don't re-throw here, as failing to show a diff might not be critical for the chat flow
        }
    }

    // --- Potential Future Additions ---

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
            // Log other errors but still return false or re-throw if appropriate
            console.error(`Error checking file existence for ${fileUri.fsPath}:`, error);
            // throw error; // Uncomment if the caller needs to know about other stat errors
            return false;
        }
    }

    /**
     * Applies a WorkspaceEdit to the workspace.
     * Useful for making structured changes like replacing entire file contents
     * while integrating with VS Code's undo/redo and dirty state.
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
        // To replace all content, we need the range of the entire document.
        // More robust way: open the document to get its full range.
        try {
            const document = await vscode.workspace.openTextDocument(fileUri);
            const fullRange = new vscode.Range(
                document.positionAt(0), // Start of the document
                document.positionAt(document.getText().length) // End of the document
            );
            edit.replace(fileUri, fullRange, newContent);
        } catch (error) {
             // Fallback to large range if document can't be opened (e.g., doesn't exist yet, though writeFile handles creation)
             console.warn(`Could not open document ${fileUri.fsPath} to determine range, using large range fallback.`, error);
             const largeRange = new vscode.Range(0, 0, 99999, 0); // Fallback range
             edit.replace(fileUri, largeRange, newContent);
        }
        return edit;
    }

}
