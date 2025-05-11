// c:\Users\marti\gemini-fs\src\test\fileService.test.ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import * as path from 'path'; // Import path for normalization
import { FileService } from '../fileService';
import { GeminiService } from '../geminiService';
import { Content } from '@google/generative-ai';

suite('FileService Test Suite', () => {
    let sandbox: sinon.SinonSandbox;
    let mockContext: vscode.ExtensionContext;
    let mockGeminiService: sinon.SinonStubbedInstance<GeminiService>;
    let fileService: FileService;
    let mockWebview: vscode.Webview;
    let workspaceFoldersStub: sinon.SinonStub; // Declare the stub in the suite scope
    // Declare fsMock with a more specific type matching FileSystem structure but with SinonStubs
    let fsMock: {
        stat: sinon.SinonStub;
        readDirectory: sinon.SinonStub;
        createDirectory: sinon.SinonStub;
        readFile: sinon.SinonStub;
        writeFile: sinon.SinonStub;
        delete: sinon.SinonStub;
        rename: sinon.SinonStub;
        copy: sinon.SinonStub; // Assuming copy is required by your @types/vscode version
        isWritableFileSystem: sinon.SinonStub; // Assuming this is required
        // Add any other methods if the error persists and lists more
    };


    const workspaceRootPath = '/test/workspace'; // POSIX style for consistency in definition
    const workspaceRootUri = vscode.Uri.file(workspaceRootPath);

    setup(() => {
        sandbox = sinon.createSandbox();

        // Mock ExtensionContext
        mockContext = {
            secrets: {
                get: sandbox.stub(),
                store: sandbox.stub(),
                onDidChange: sandbox.stub(),
            },
            subscriptions: [], // Ensure subscriptions is an array
            // Add other ExtensionContext properties if needed by FileService constructor
        } as any;

        // Stub GeminiService
        mockGeminiService = sandbox.createStubInstance(GeminiService);

        fileService = new FileService(mockContext, mockGeminiService);

        // Mock Webview
        mockWebview = {
            postMessage: sandbox.stub().resolves(true),
        } as any;
        // Mock vscode.workspace
        workspaceFoldersStub = sandbox.stub().returns([{ uri: workspaceRootUri, name: 'test-workspace', index: 0 }]);
        sandbox.replaceGetter(vscode.workspace, 'workspaceFolders', workspaceFoldersStub);

        fsMock = { // Initialize fsMock in the suite scope
            readFile: sandbox.stub().callsFake((uri: vscode.Uri) => {
                if (uri.fsPath.includes('test.txt') || uri.fsPath.includes('readable.txt')) {
                    const stringContent = 'Hello from test file!';
                    const bufferData = Buffer.from(stringContent);
                    const uint8ArrayData = new Uint8Array(bufferData);
                    // Log the type and value to see if it's undefined here
                    console.log(`[TEST_DEBUG] Mocking readFile for ${uri.fsPath}: type of uint8ArrayData is ${typeof uint8ArrayData}, value is:`, uint8ArrayData);
                    return Promise.resolve(uint8ArrayData);
                }
                return Promise.reject(new vscode.FileSystemError('File not found by default mock: ' + uri.fsPath));
            }),
            writeFile: sandbox.stub(),
            delete: sandbox.stub(),
            readDirectory: sandbox.stub().callsFake(async (uri: vscode.Uri) => {
                const currentPath = path.normalize(uri.fsPath);
                const rootFsPath = path.normalize(workspaceRootUri.fsPath); // Platform-specific root

                const isWindows = process.platform === "win32";
                const comparePaths = (p1: string, p2: string): boolean => {
                    if (isWindows) {
                        return p1.toLowerCase() === p2.toLowerCase();
                    }
                    return p1 === p2;
                };

                // Specific mock for 'src' directory
                if (comparePaths(currentPath, path.join(rootFsPath, 'src'))) {
                    return Promise.resolve([
                        ['file1.txt', vscode.FileType.File],
                        ['subdir', vscode.FileType.Directory],
                        ['file2.ts', vscode.FileType.File],
                    ]);
                }
                // Specific mock for the workspace root directory
                if (comparePaths(currentPath, rootFsPath)) {
                    return Promise.resolve([
                        ['rootfile.md', vscode.FileType.File],
                        ['src', vscode.FileType.Directory],
                        ['emptyDir', vscode.FileType.Directory],
                    ]);
                }
                // Specific mock for 'emptyDir' (assuming it's at the root for this test)
                if (comparePaths(currentPath, path.join(rootFsPath, 'emptyDir'))) {
                    return Promise.resolve([]);
                }
                 // Specific mock for 'emptyDir' within 'src'
                if (comparePaths(currentPath, path.join(rootFsPath, 'src', 'emptyDir'))) {
                    return Promise.resolve([]);
                }
                // Default to directory not found for other paths
                return Promise.reject(new vscode.FileSystemError('Directory not found by default mock: ' + uri.fsPath));
            }),
            stat: sandbox.stub(), 
            createDirectory: sandbox.stub(), 
            rename: sandbox.stub(), 
            copy: sandbox.stub(), 
            isWritableFileSystem: sandbox.stub(),
        };
        sandbox.replaceGetter(vscode.workspace, 'fs', () => fsMock as unknown as vscode.FileSystem);

        // Mock vscode.window
        sandbox.stub(vscode.window, 'showErrorMessage'); 
        sandbox.stub(vscode.window, 'showWarningMessage');
    });

    teardown(() => {
        sandbox.restore();
    });

    suite('secureResolvePath', () => {
        test('should resolve a valid relative path within the workspace', async () => {
            const relativePath = 'src/file.txt';
            const expectedUri = vscode.Uri.joinPath(workspaceRootUri, relativePath);
            // @ts-ignore access private method for testing
            const resolvedUri = await fileService.secureResolvePath(relativePath, mockWebview);
            assert.deepStrictEqual(resolvedUri?.fsPath, expectedUri.fsPath);
            sinon.assert.notCalled(mockWebview.postMessage as sinon.SinonStub);
        });

        test('should return null and post error for path outside workspace', async () => {
            const relativePath = '../outside.txt'; 
             // @ts-ignore
            const resolvedUri = await fileService.secureResolvePath(relativePath, mockWebview);
            assert.strictEqual(resolvedUri, null);
            sinon.assert.calledOnce(mockWebview.postMessage as sinon.SinonStub);
            assert.ok((mockWebview.postMessage as sinon.SinonStub).calledWith(sinon.match({ command: 'error', text: sinon.match(/outside the workspace/) })));
        });

        test('should return null and post error for overly relative path like ".." ', async () => {
            const relativePath = '..';
             // @ts-ignore
            const resolvedUri = await fileService.secureResolvePath(relativePath, mockWebview);
            assert.strictEqual(resolvedUri, null);
            sinon.assert.calledOnce(mockWebview.postMessage as sinon.SinonStub);
            assert.ok((mockWebview.postMessage as sinon.SinonStub).calledWith(sinon.match({ command: 'error', text: sinon.match(/Access denied: Path '\.\.' is outside the workspace./) })));
        });

        test('should return null if no workspace is open', async () => {
            workspaceFoldersStub.returns(undefined); 
            const relativePath = 'src/file.txt';
             // @ts-ignore
            const resolvedUri = await fileService.secureResolvePath(relativePath, mockWebview);
            assert.strictEqual(resolvedUri, null);
            sinon.assert.calledOnce(mockWebview.postMessage as sinon.SinonStub);
            assert.ok((mockWebview.postMessage as sinon.SinonStub).calledWith(sinon.match({ command: 'error', text: sinon.match(/No workspace folder is open/) })));
        });
    });

    suite('handleChatMessage - /read command', () => {
        test('should read and post file content for valid /read command', async () => {
            const filePath = 'src/test.txt';
            const fileContent = 'Hello from test file!'; 
            // const targetUri = vscode.Uri.joinPath(workspaceRootUri, filePath); // Not strictly needed for this test

            await fileService.handleChatMessage(`/read ${filePath}`, mockWebview);

            sinon.assert.calledOnce(fsMock.readFile as sinon.SinonStub);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                command: 'geminiResponse',
                text: sinon.match(new RegExp(`Content of ${filePath.replace(/[\/]/g, '[\\/]')}:`)) 
            }));
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                text: sinon.match(fileContent)
            }));
        });

        test('should post error if /read file path is missing', async () => {
            await fileService.handleChatMessage('/read ', mockWebview);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({ command: 'error', text: sinon.match(/Please specify a file path/) }));
        });

        test('should post error if /read file is not found (via secureResolvePath)', async () => {
            const filePath = '../outside.txt';
            await fileService.handleChatMessage(`/read ${filePath}`, mockWebview);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({ command: 'error', text: sinon.match(/outside the workspace/) }));
            sinon.assert.notCalled(fsMock.readFile as sinon.SinonStub);
        });

         test('should post error if fs.readFile throws', async () => {
            const filePath = 'src/unreadable.txt'; 
            const targetUri = vscode.Uri.joinPath(workspaceRootUri, filePath); // Used to target the mock
            (fsMock.readFile as sinon.SinonStub)
                .withArgs(sinon.match((uri: vscode.Uri) => uri.fsPath === targetUri.fsPath))
                .rejects(new Error('FS Read Error'));

            await fileService.handleChatMessage(`/read ${filePath}`, mockWebview);

            sinon.assert.calledOnce(fsMock.readFile as sinon.SinonStub);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                command: 'error',
                text: sinon.match(/Failed to read file .* FS Read Error/)
            }));
        });
    });

    suite('handleChatMessage - /list command', () => {
        test('should list files and directories for a valid path (e.g., src)', async () => {
            const dirPath = 'src';
            
            await fileService.handleChatMessage(`/list ${dirPath}`, mockWebview);

            sinon.assert.calledOnce(fsMock.readDirectory as sinon.SinonStub);
            const postMessageStub = mockWebview.postMessage as sinon.SinonStub;
            const callArgs = postMessageStub.lastCall.args[0];

            assert.strictEqual(callArgs.command, 'geminiResponse');
            assert.ok(callArgs.text.includes(`Contents of ${dirPath}:`));
            assert.ok(callArgs.text.includes('Directories:\n- subdir/'));
            assert.ok(callArgs.text.includes('Files:\n- file1.txt\n- file2.ts'));
        });

        test('should list contents of workspace root if no path is provided for /list', async () => {
            await fileService.handleChatMessage('/list', mockWebview); // No path

            sinon.assert.calledOnce(fsMock.readDirectory as sinon.SinonStub);
            const postMessageStub = mockWebview.postMessage as sinon.SinonStub;
            const callArgs = postMessageStub.lastCall.args[0];

            assert.strictEqual(callArgs.command, 'geminiResponse');
            assert.ok(callArgs.text.includes('Contents of .:')); // Path is '.' for root
            assert.ok(callArgs.text.includes('Directories:\n- src/\n- emptyDir/'));
            assert.ok(callArgs.text.includes('Files:\n- rootfile.md'));
        });

        test('should handle an empty directory for /list', async () => {
            const dirPath = 'emptyDir'; // Assuming emptyDir is at root as per fsMock setup
            
            await fileService.handleChatMessage(`/list ${dirPath}`, mockWebview);

            sinon.assert.calledOnce(fsMock.readDirectory as sinon.SinonStub);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                command: 'geminiResponse',
                text: sinon.match(/\(empty directory\)/)
            }));
        });

        test('should post error if /list path is outside workspace', async () => {
            const dirPath = '../../forbidden'; 
            await fileService.handleChatMessage(`/list ${dirPath}`, mockWebview);

            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({ command: 'error', text: sinon.match(/outside the workspace/) }));
            sinon.assert.notCalled(fsMock.readDirectory as sinon.SinonStub);
        });

        test('should post error if fs.readDirectory throws for /list', async () => {
            const dirPath = 'src/unreadableDir'; 
            const targetUri = vscode.Uri.joinPath(workspaceRootUri, dirPath); // Used to target the mock
            (fsMock.readDirectory as sinon.SinonStub)
                .withArgs(sinon.match((uri: vscode.Uri) => {
                    const isWindows = process.platform === "win32";
                    const p1 = path.normalize(uri.fsPath);
                    const p2 = path.normalize(targetUri.fsPath);
                    return isWindows ? p1.toLowerCase() === p2.toLowerCase() : p1 === p2;
                }))
                .rejects(new Error('FS List Error'));

            await fileService.handleChatMessage(`/list ${dirPath}`, mockWebview);

            sinon.assert.calledOnce(fsMock.readDirectory as sinon.SinonStub);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                command: 'error',
                text: sinon.match(/Failed to list directory .* FS List Error/)
            }));
        });
    });

    suite('handleChatMessage - /create command', () => {
        test('should ask Gemini for content and show preview for valid /create command', async () => {
            const filePath = 'src/newFile.txt';
            const description = 'a simple hello world file';
            const geminiGeneratedContent = 'Hello, World from Gemini!';
            const targetUri = vscode.Uri.joinPath(workspaceRootUri, filePath);

            (fsMock.stat as sinon.SinonStub)
                .withArgs(sinon.match((uri: vscode.Uri) => uri.fsPath === targetUri.fsPath))
                .rejects(new vscode.FileSystemError('File not found')); 

            mockGeminiService.askGeminiWithHistory.resolves(geminiGeneratedContent);

            await fileService.handleChatMessage(`/create ${filePath} ${description}`, mockWebview);

            sinon.assert.calledOnce(fsMock.stat as sinon.SinonStub);
            sinon.assert.calledOnce(mockGeminiService.askGeminiWithHistory);

            const historyArg = mockGeminiService.askGeminiWithHistory.firstCall.args[0] as Content[];
            
            // --- Start Debug Logging ---
            if (!historyArg || historyArg.length === 0) {
                console.error("TEST DEBUG: historyArg is undefined, null, or empty!");
            } else {
                console.log(`TEST DEBUG: historyArg (length: ${historyArg.length}) received by askGeminiWithHistory:`);
                historyArg.forEach((item, index) => {
                    console.log(`  [${index}] role: ${item.role}, text: ${item.parts[0]?.text?.substring(0, 70)}...`);
                });
            }
            // --- End Debug Logging ---

            const geminiPrompt = historyArg.find(h => 
                h.role === 'user' && 
                h.parts && h.parts.length > 0 && 
                typeof h.parts[0].text === 'string' && 
                h.parts[0].text.startsWith('Create the content for a new file named'));
            
            assert.ok(geminiPrompt, `Gemini prompt for creation not found in history. historyArg was: ${JSON.stringify(historyArg, null, 2)}`);
            assert.ok(geminiPrompt!.parts[0].text?.toString().includes(`named '${filePath}'`));
            assert.ok(geminiPrompt!.parts[0].text?.toString().includes(description));

            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                command: 'showFilePreview',
                action: 'create',
                filePath: filePath,
                proposedContent: geminiGeneratedContent,
                message: sinon.match(/Gemini proposes creating/)
            }));

            // @ts-ignore
            const finalHistory = fileService.conversationHistory.get('globalChat') as Content[];
            assert.ok(finalHistory.some(h => h.role === 'model' && h.parts[0].text?.toString().includes(`Proposed content for ${filePath}`)), 'Model response with proposed content not in history');
        });

        test('should post error if file already exists for /create command', async () => {
            const filePath = 'src/existingFile.txt';
            const description = 'some description';
            const targetUri = vscode.Uri.joinPath(workspaceRootUri, filePath);

            (fsMock.stat as sinon.SinonStub)
                .withArgs(sinon.match((uri: vscode.Uri) => uri.fsPath === targetUri.fsPath))
                .resolves({ type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0 }); 

            await fileService.handleChatMessage(`/create ${filePath} ${description}`, mockWebview);

            sinon.assert.calledOnce(fsMock.stat as sinon.SinonStub);
            sinon.assert.notCalled(mockGeminiService.askGeminiWithHistory);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                command: 'error',
                text: sinon.match(/File already exists.*Use \/write to modify/)
            }));
        });

        test('should post error if GeminiService fails for /create command', async () => {
            const filePath = 'src/anotherNewFile.txt';
            const description = 'content for this one';
            const targetUri = vscode.Uri.joinPath(workspaceRootUri, filePath);

            (fsMock.stat as sinon.SinonStub)
                .withArgs(sinon.match((uri: vscode.Uri) => uri.fsPath === targetUri.fsPath))
                .rejects(new vscode.FileSystemError('File not found'));

            mockGeminiService.askGeminiWithHistory.rejects(new Error('Gemini API Error'));

            await fileService.handleChatMessage(`/create ${filePath} ${description}`, mockWebview);

            sinon.assert.calledOnce(mockGeminiService.askGeminiWithHistory);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({
                command: 'error',
                text: sinon.match(/Error asking Gemini to generate content.*Gemini API Error/)
            }));
        });

        test('should post usage error if /create command is missing filepath', async () => {
            await fileService.handleChatMessage('/create ', mockWebview);
            sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({ command: 'error', text: sinon.match(/Usage: \/create <filePath>/) }));
            sinon.assert.notCalled(mockGeminiService.askGeminiWithHistory);
        });
    });

    // TODO: Add more test suites for:
    // - /write command (read original, intent to Gemini, preview, (later) confirmed write)
    // - /delete command (confirmation prompt, (later) confirmed deletion)
    // - performConfirmedCreate, performConfirmedWrite, performConfirmedDelete methods

    test('handleChatMessage should update conversation history for general query', async () => {
        const message = "hello gemini";
        mockGeminiService.askGeminiWithHistory.resolves("Hello user!");

        await fileService.handleChatMessage(message, mockWebview);

        // @ts-ignore Access private member for test verification
        const history = fileService.conversationHistory.get('globalChat') as Content[];
        assert.ok(history.length >= 2, "History should have at least user and model message");
        assert.deepStrictEqual(history[history.length - 2].parts[0].text, message);
        assert.deepStrictEqual(history[history.length - 1].parts[0].text, "Hello user!");
    });

    test('handleChatMessage should update conversation history for /read command success', async () => {
        const filePath = 'src/test.txt';
        
        await fileService.handleChatMessage(`/read ${filePath}`, mockWebview);
        // @ts-ignore
        const history = fileService.conversationHistory.get('globalChat') as Content[];
        assert.ok(history.length >= 2);
        assert.strictEqual(history[history.length - 2].parts[0].text, `/read ${filePath}`);
        assert.ok((history[history.length - 1].parts[0].text as string).startsWith(`Successfully read and displayed content of ${filePath}`));
    });

     test('handleChatMessage should update conversation history for /list command success', async () => {
        const dirPath = 'src';
        
        await fileService.handleChatMessage(`/list ${dirPath}`, mockWebview);
        // @ts-ignore
        const history = fileService.conversationHistory.get('globalChat') as Content[];
        assert.ok(history.length >= 2);
        assert.strictEqual(history[history.length - 2].parts[0].text, `/list ${dirPath}`);
        assert.strictEqual(history[history.length - 1].parts[0].text, `Listed contents of directory: ${dirPath}`);
    });

    test('handleChatMessage should update conversation history for command error', async () => {
        const filePath = '../outside.txt'; 
        await fileService.handleChatMessage(`/read ${filePath}`, mockWebview);
         // @ts-ignore
        const history = fileService.conversationHistory.get('globalChat') as Content[] | undefined;
        assert.ok(history, 'History should exist');
        assert.strictEqual(history.length, 1, "History should only contain the user's message in this error case");

        assert.strictEqual(history[0].role, 'user');
        assert.strictEqual(history[0].parts[0].text, `/read ${filePath}`);

        sinon.assert.calledWith(mockWebview.postMessage as sinon.SinonStub, sinon.match({ command: 'error', text: sinon.match(/outside the workspace/) }));
    });

});
