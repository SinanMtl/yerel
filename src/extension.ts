// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DocumentParser, ExtractedText } from '@sinanmtl/doc-parser';
import { StringReplacer } from './stringReplacer';
import { OpenAIService } from './openaiService';
import { GoogleSheetsService } from './googleSheetsService';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "yerel" is now active!');
	// Initialize parser
	const parser = new DocumentParser();

	// Register commands
	const extractStringsCommand = vscode.commands.registerCommand('yerel.extractStrings', async (uri?: vscode.Uri) => {
		try {
			if (uri) {
				await extractFromFile(uri, parser);
			} else {
				await extractFromActiveFile(parser);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`Yerel: ${error}`);
		}
	});

	const extractFromSelectionCommand = vscode.commands.registerCommand('yerel.extractFromSelection', async () => {
		try {
			await extractFromSelection();
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

	const testGoogleSheetsCommand = vscode.commands.registerCommand('yerel.testGoogleSheets', async () => {
		try {
			await testGoogleSheetsConnection();
		} catch (error) {
			vscode.window.showErrorMessage(`Yerel: ${error}`);
		}
	});

	const exportAllToSheetsCommand = vscode.commands.registerCommand('yerel.exportAllToSheets', async () => {
		try {
			await exportAllTranslationsToSheets();
		} catch (error) {
			vscode.window.showErrorMessage(`Yerel: ${error}`);
		}
	});

	context.subscriptions.push(
		extractStringsCommand,
		extractFromSelectionCommand,
		configureSettingsCommand,
		testOpenAICommand,
		testGoogleSheetsCommand,
		exportAllToSheetsCommand
	);
}

async function extractFromDocument(document: vscode.TextDocument, parser: DocumentParser) {
	const extension = '.'+parser.getFileExtension(document.fileName);
	const result = parser.parseContent(document.getText(), extension);
	const summary = parser.generateSummary(result ? [result] : []);

	if (summary.allTexts.length === 0) {
		vscode.window.showInformationMessage('No extractable strings found in this file.');
		return;
	}

	// Show preview of found strings
	await showStringPreview(summary.allTexts, document);
}

async function extractFromFile(uri: vscode.Uri, parser: DocumentParser) {
	const document = await vscode.workspace.openTextDocument(uri);
	extractFromDocument(document, parser);
}

async function extractFromActiveFile(parser: DocumentParser) {
	const activeEditor = vscode.window.activeTextEditor;
	if (!activeEditor) {
		vscode.window.showWarningMessage('No active file to extract strings from');
		return;
	}

	extractFromDocument(activeEditor.document, parser);
}

async function extractFromSelection() {
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
	const originalStartPosition = activeEditor.document.offsetAt(selection.start);
	const originalEndPosition = activeEditor.document.offsetAt(selection.end);

	// Create a mock extractable string for the selection
	const extractableString: ExtractedText[] = [{
		text: selectedText,
		type: 'string',
		context: 'javascript', // Default context
		lineNumber: selection.start.line,
		startPosition: selection.start.character,
		endPosition: selection.end.character,
		columnStart: selection.start.character,
		columnEnd: selection.end.character,
		absoluteStart: originalStartPosition,
		absoluteEnd: originalEndPosition,
		originalAbsoluteStart: originalStartPosition,
		originalAbsoluteEnd: originalEndPosition,
		originalStartPosition: originalStartPosition,
		originalEndPosition: originalEndPosition,
		originalMatch: selectedText
	}];

	// Show preview for single string
	await showStringPreview(extractableString, activeEditor.document);
}

async function showStringPreview(strings: ExtractedText[], document: vscode.TextDocument) {
	// Create quick pick items with preview of replacement
	const items: vscode.QuickPickItem[] = strings.map((str) => {
		const preview = StringReplacer.previewReplacement(str, document.uri);
		return {
			label: `"${str.text}"`,
			description: `→ ${preview}`,
			detail: `Line ${(str.lineNumber ?? 0)} • Context: ${str.context}`,
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
	await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:ateam.yerel');
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

async function testGoogleSheetsConnection() {
	if (!GoogleSheetsService.isConfigured()) {
		GoogleSheetsService.showSetupInstructions();
		return;
	}

	// Show progress while testing
	const result = await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: '📊 Testing Google Sheets Connection',
		cancellable: false
	}, async (progress) => {
		progress.report({ increment: 0, message: 'Validating configuration...' });
		
		const testResult = await GoogleSheetsService.testConnection();
		
		progress.report({ increment: 100, message: testResult.success ? '✅ Success!' : '❌ Failed!' });
		
		return testResult;
	});
	
	if (result.success) {
		vscode.window.showInformationMessage(result.message);
	} else {
		vscode.window.showErrorMessage(result.message);
	}
}

async function exportAllTranslationsToSheets() {
	if (!GoogleSheetsService.isConfigured()) {
		GoogleSheetsService.showSetupInstructions();
		return;
	}

	// Confirm action
	const choice = await vscode.window.showWarningMessage(
		'🔄 This will export ALL existing translations from your locale files to Google Sheets. This may overwrite existing data in the spreadsheet. Continue?',
		'Export All',
		'Cancel'
	);

	if (choice !== 'Export All') {
		return;
	}

	try {
		await GoogleSheetsService.exportAllLocaleFiles();
	} catch (error) {
		// Error already handled in the service
		console.error('Export all translations failed:', error);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {}
