import * as vscode from 'vscode';
import { ExtractableString, TranslationEntry } from './types';
import { ConfigManager } from './configManager';
import { LocaleManager } from './localeManager';

export class StringReplacer {
    
    /**
     * Replace selected strings with translation keys
     */
    public static async replaceStrings(
        strings: ExtractableString[], 
        document: vscode.TextDocument
    ): Promise<void> {
        const config = ConfigManager.getConfig();
        const translationEntries: TranslationEntry[] = [];
        const edits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();

        // Sort strings by position (reverse order to maintain correct positions during replacement)
        const sortedStrings = [...strings].sort((a, b) => b.startPosition - a.startPosition);

        for (const str of sortedStrings) {
            // Generate unique key
            const baseKey = ConfigManager.formatKey(str.text);
            const uniqueKey = await LocaleManager.generateUniqueKey(baseKey, document.uri);
            
            // Create translation entry
            const translationEntry = LocaleManager.generateTranslations(str.text, uniqueKey);
            translationEntries.push(translationEntry);

            // Generate replacement text based on context
            const replacementText = this.generateReplacementText(uniqueKey, str, config);

            // Create text edit
            const startPos = document.positionAt(str.startPosition);
            const endPos = document.positionAt(str.endPosition);
            const range = new vscode.Range(startPos, endPos);
            
            edits.replace(document.uri, range, replacementText);
        }

        // Apply all edits
        const success = await vscode.workspace.applyEdit(edits);
        
        if (success) {
            // Save translations to locale files
            await LocaleManager.saveTranslations(translationEntries, document.uri);
            
            vscode.window.showInformationMessage(
                `Successfully extracted ${strings.length} string(s) and updated locale files!`
            );
        } else {
            throw new Error('Failed to apply text edits');
        }
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
    public static previewReplacement(str: ExtractableString): string {
        const config = ConfigManager.getConfig();
        const key = ConfigManager.formatKey(str.text);
        return this.generateReplacementText(key, str, config);
    }
}
