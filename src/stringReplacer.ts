declare global {
    var __yerelKeyValueMap: Record<string, string> | undefined;
}
import * as vscode from 'vscode';
import * as path from 'path';
import { ExtractableString, TranslationEntry } from './types';
import { ConfigManager } from './configManager';
import { LocaleManager } from './localeManager';

export class StringReplacer {
    
    /**
     * Generate key with file path information
     */
    private static generateKeyWithPath(text: string, documentUri: vscode.Uri): string {
        const config = ConfigManager.getConfig();
        const workspaceRoot = ConfigManager.getWorkspaceRoot();
        
        // Get relative path from workspace root
        let relativePath = '';
        if (workspaceRoot) {
            const workspaceUri = vscode.Uri.file(workspaceRoot);
            relativePath = vscode.workspace.asRelativePath(documentUri, false);
        } else {
            // Fallback to filename if no workspace
            relativePath = path.basename(documentUri.fsPath);
        }
        
        // Remove file extension and normalize path separators
        const pathWithoutExtension = relativePath.replace(/\.[^/.]+$/, '');
        const normalizedPath = pathWithoutExtension.replace(/[\\\/]/g, '.');
        
        // Get first word from text for the final key
        const firstWord = text.trim().split(/\s+/)[0]
            .toLowerCase()
            .replace(/[^a-zA-Z0-9]/g, '')
            .substring(0, 12); // Limit length
        
        // Combine path and first word
        const pathKey = normalizedPath.toLowerCase().replace(/[^a-zA-Z0-9.]/g, '');
        return `${pathKey}.${firstWord}`;
    }

    /**
     * Replace selected strings with translation keys
     */
    public static async replaceStrings(
        strings: ExtractableString[], 
        document: vscode.TextDocument
    ): Promise<void> {
        const config = ConfigManager.getConfig();
        
        // Show overall progress for the entire extraction process
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `🌍 Extracting ${strings.length} string(s) to i18n`,
            cancellable: false
        }, async (progress) => {
            const translationEntries: TranslationEntry[] = [];
            const edits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();

            // Sort strings by position (reverse order to maintain correct positions during replacement)
            const sortedStrings = [...strings].sort((a, b) => b.startPosition - a.startPosition);

            for (let i = 0; i < sortedStrings.length; i++) {
                const str = sortedStrings[i];
                
                progress.report({ 
                    increment: (50 / sortedStrings.length), // First 50% for key generation
                    message: `Generating key for "${str.text.substring(0, 20)}${str.text.length > 20 ? '...' : ''}"` 
                });

                // Generate unique key with file path
                const baseKey = this.generateKeyWithPath(str.text, document.uri);

                // Batch içi key-value eşleşmelerini kontrol etmek için static bir map
                if (!globalThis.__yerelKeyValueMap) {
                    globalThis.__yerelKeyValueMap = {};
                }
                const keyValueMap = globalThis.__yerelKeyValueMap;

                let uniqueKey = baseKey;
                let counter = 1;
                // Önce batch içi kontrol
                while (
                    (keyValueMap[uniqueKey] && keyValueMap[uniqueKey] !== str.text) ||
                    (await LocaleManager.generateUniqueKey(uniqueKey, str.text, document.uri)) !== uniqueKey
                ) {
                    uniqueKey = `${baseKey}_${counter}`;
                    counter++;
                }
                keyValueMap[uniqueKey] = str.text;
                
                // Create translation entry (this will show its own progress for OpenAI)
                const translationEntry = await LocaleManager.generateTranslations(str.text, uniqueKey);
                translationEntries.push(translationEntry);

                // Generate replacement text based on context
                const replacementText = this.generateReplacementText(uniqueKey, str, config);

                // Create text edit
                const startPos = document.positionAt(str.startPosition);
                const endPos = document.positionAt(str.endPosition);
                const range = new vscode.Range(startPos, endPos);
                
                edits.replace(document.uri, range, replacementText);
            }

            progress.report({ 
                increment: 25, 
                message: 'Applying text changes...' 
            });

            // Apply all edits
            const success = await vscode.workspace.applyEdit(edits);
            
            if (success) {
                progress.report({ 
                    increment: 15, 
                    message: 'Saving translation files...' 
                });
                
                // Save translations to locale files
                await LocaleManager.saveTranslations(translationEntries, document.uri);
                
                // Complete the progress to 100%
                progress.report({ 
                    increment: 10, 
                    message: 'Completed successfully!' 
                });
            } else {
                throw new Error('Failed to apply text edits');
            }
        });

        // Show success message outside progress (after a small delay)
        await new Promise(resolve => setTimeout(resolve, 300));
        
        vscode.window.showInformationMessage(
            `🎉 Successfully extracted ${strings.length} string(s) and updated locale files!`
        );
    }

    /**
     * Generate replacement text based on context and configuration
     */
    private static generateReplacementText(
        key: string, 
        str: ExtractableString, 
        config: any
    ): string {
        switch (str.context) {
            case 'html':
                // For HTML context, use template syntax
                return ConfigManager.generateTemplate(key, config);
                
            case 'javascript':
                // For JavaScript context, determine if it's in a string literal or template
                const func = config.translationFunction;
                return `${func}('${key}')`;
                
            case 'template':
                // For template context (Vue, Angular, etc.)
                return ConfigManager.generateTemplate(key, config);
                
            default:
                return ConfigManager.generateTemplate(key, config);
        }
    }

    /**
     * Preview replacement for a single string
     */
    public static previewReplacement(str: ExtractableString, documentUri?: vscode.Uri): string {
        const config = ConfigManager.getConfig();
        let key: string;
        
        if (documentUri) {
            key = this.generateKeyWithPath(str.text, documentUri);
        } else {
            // Fallback to old key generation for preview
            key = ConfigManager.formatKey(str.text);
        }
        
        return this.generateReplacementText(key, str, config);
    }
}
