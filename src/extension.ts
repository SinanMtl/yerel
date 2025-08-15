// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { StringDetector } from './stringDetector';
import { ConfigManager } from './configManager';
import { StringReplacer } from './stringReplacer';
import { OpenAIService } from './openaiService';
import { ExtractableString } from './types';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "yerel" is now active!');

	const stringDetector = new StringDetector();

	// Register commands
	const extractStringsCommand = vscode.commands.registerCommand('yerel.extractStrings', async (uri?: vscode.Uri) => {
		try {
			if (uri) {
				await extractFromFile(uri, stringDetector);
			} else {
				await extractFromActiveFile(stringDetector);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Yerel: ${error}`);
		}
	});

	const extractFromSelectionCommand = vscode.commands.registerCommand('yerel.extractFromSelection', async () => {
		try {
			await extractFromSelection(stringDetector);
		} catch (error) {
			vscode.window.showErrorMessage(`Yerel: ${error}`);
		}
	});

	const configureSettingsCommand = vscode.commands.registerCommand('yerel.configureSettings', async () => {
		try {
			await openSettings();
		} catch (error) {
			vscode.window.showErrorMessage(`Yerel: ${error}`);
		}
	});

	const testOpenAICommand = vscode.commands.registerCommand('yerel.testOpenAI', async () => {
		try {
			await testOpenAIConnection();
		} catch (error) {
			vscode.window.showErrorMessage(`Yerel: ${error}`);
		}
	});

	context.subscriptions.push(extractStringsCommand, extractFromSelectionCommand, configureSettingsCommand, testOpenAICommand);
}

async function extractFromFile(uri: vscode.Uri, detector: StringDetector) {
	const document = await vscode.workspace.openTextDocument(uri);
	const result = detector.detectStrings(document);
	
	if (result.strings.length === 0) {
		vscode.window.showInformationMessage('No extractable strings found in this file.');
		return;
	}

	// Show preview of found strings
	await showStringPreview(result.strings, document);
}

async function extractFromActiveFile(detector: StringDetector) {
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		vscode.window.showWarningMessage('No active file to extract strings from');
		return;
	}
	
	const document = activeEditor.document;
	const result = detector.detectStrings(document);
	
	if (result.strings.length === 0) {
		vscode.window.showInformationMessage('No extractable strings found in this file.');
		return;
	}

	// Show preview of found strings
	await showStringPreview(result.strings, document);
}

async function extractFromSelection(detector: StringDetector) {
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		vscode.window.showWarningMessage('No active editor');
		return;
	}

	const selection = activeEditor.selection;
	if (selection.isEmpty) {
		vscode.window.showWarningMessage('No text selected');
		return;
	}

	const selectedText = activeEditor.document.getText(selection).trim();
	
	// Create a mock extractable string for the selection
	const extractableString: ExtractableString = {
		text: selectedText,
		startPosition: activeEditor.document.offsetAt(selection.start),
		endPosition: activeEditor.document.offsetAt(selection.end),
		lineNumber: selection.start.line,
		columnStart: selection.start.character,
		columnEnd: selection.end.character,
		context: 'javascript', // Default context
		suggestedKey: ConfigManager.formatKey(selectedText)
	};

	// Show preview for single string
	await showStringPreview([extractableString], activeEditor.document);
}

async function showStringPreview(strings: ExtractableString[], document: vscode.TextDocument) {
	// Create quick pick items with preview of replacement
	const items: vscode.QuickPickItem[] = strings.map((str, index) => {
		const preview = StringReplacer.previewReplacement(str, document.uri);
		return {
			label: `"${str.text}"`,
			description: `→ ${preview}`,
			detail: `Line ${str.lineNumber + 1} • Context: ${str.context}`,
			picked: true // Pre-select all items
		};
	});

	const selected = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		placeHolder: 'Select strings to extract (press Enter to extract all selected)',
		title: `Found ${strings.length} extractable string(s) in ${document.fileName}`
	});

	if (selected && selected.length > 0) {
		const selectedStrings = strings.filter((_, index) => 
			selected.some(item => item.label === `"${strings[index].text}"`)
		);

		try {
			await StringReplacer.replaceStrings(selectedStrings, document);
		} catch (error) {
			vscode.window.showErrorMessage(`Failed to extract strings: ${error}`);
		}
	}
}

async function openSettings() {
	await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:yerel');
}

async function testOpenAIConnection() {
	if (!OpenAIService.isConfigured()) {
		vscode.window.showWarningMessage('OpenAI is not configured. Please set your API key in settings.');
		await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:yerel openai');
		return;
	}

	// Show progress while testing
	const result = await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: '🤖 Testing OpenAI Connection',
		cancellable: false
	}, async (progress) => {
		progress.report({ increment: 0, message: 'Connecting to OpenAI API...' });
		
		const testResult = await OpenAIService.testConnection();
		
		progress.report({ increment: 100, message: testResult.success ? '✅ Success!' : '❌ Failed!' });
		
		return testResult;
	});
	
	if (result.success) {
		vscode.window.showInformationMessage('✅ OpenAI connection successful! Ready to translate.');
	} else {
		vscode.window.showErrorMessage(`❌ OpenAI connection failed: ${result.error}`);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
