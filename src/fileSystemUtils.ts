// c:\Users\marti\gemini-fs\src\fileSystemUtils.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ChatMessage } from './geminiService'; // Assuming ChatMessage is needed by showSystemMessageCallback

export async function readFileContentUtil(uri: vscode.Uri): Promise<string> {
    const uint8Array = await vscode.workspace.fs.readFile(uri);
    return new TextDecoder().decode(uint8Array);
}

export async function writeFileContentUtil(uri: vscode.Uri, content: string): Promise<void> {
    const uint8Array = new TextEncoder().encode(content);
    await vscode.workspace.fs.writeFile(uri, uint8Array);
}

export function resolvePathUtil(
    rawPath: string,
    currentWorkspaceRoot: vscode.Uri | undefined,
    webview: vscode.Webview,
    showSystemMessageCallback: (webview: vscode.Webview, message: string, historyToUpdate?: ChatMessage[]) => void,
    historyToUpdateForMessage?: ChatMessage[]
): { uri: vscode.Uri, relativePath: string } | null { // Return null on error to allow caller to handle
    if (!currentWorkspaceRoot) {
        showSystemMessageCallback(webview, "No workspace folder is open.", historyToUpdateForMessage);
        return null;
    }
    const rootUri = currentWorkspaceRoot; 
    let normalizedPath = rawPath.trim().replace(/\\/g, '/');
    normalizedPath = normalizedPath.replace(/^[/\\]+/, '');

    let targetUri: vscode.Uri;
    try {
        targetUri = vscode.Uri.joinPath(rootUri, normalizedPath);
    } catch (e: any) {
        showSystemMessageCallback(webview, `Invalid path format: ${rawPath}`, historyToUpdateForMessage);
        return null;
    }

    const rootFsPath = rootUri.fsPath.replace(/\\/g, '/');
    const targetFsPath = targetUri.fsPath.replace(/\\/g, '/');

    if (!targetFsPath.startsWith(rootFsPath) && targetFsPath !== rootFsPath) {
        showSystemMessageCallback(webview, `Path is outside the workspace: ${normalizedPath}`, historyToUpdateForMessage);
        return null;
    }
    const displayRelativePath = targetFsPath.startsWith(rootFsPath)
        ? targetFsPath.slice(rootFsPath.length).replace(/\\/g, '/')
        : targetFsPath.replace(/\\/g, '/');
    return { uri: targetUri, relativePath: displayRelativePath || '.' };
}

export function ensureWorkspaceOpenUtil(
    currentWorkspaceRoot: vscode.Uri | undefined,
    webview: vscode.Webview,
    showSystemMessageCallback: (webview: vscode.Webview, message: string, historyToUpdate?: ChatMessage[]) => void,
    historyToUpdate: ChatMessage[]
): boolean {
    if (!currentWorkspaceRoot) {
        showSystemMessageCallback(webview, "No workspace folder is open. Please open a folder to use file system commands.", historyToUpdate);
        return false;
    }
    return true;
}
