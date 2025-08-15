import * as vscode from 'vscode';
import { YerelConfig } from './types';

export class ConfigManager {
    private static readonly EXTENSION_ID = 'yerel';

    /**
     * Get current extension configuration
     */
    public static getConfig(): YerelConfig {
        const config = vscode.workspace.getConfiguration(this.EXTENSION_ID);
        
        // Handle language presets
        const supportedLanguages = this.resolveLanguages(config);
        
        return {
            translationFunction: config.get('translationFunction', '$t'),
            templateSyntax: config.get('templateSyntax', '{{ {func}(\'{key}\') }}'),
            localesPath: config.get('localesPath', 'locales'),
            supportedLanguages: supportedLanguages,
            keyNamingStyle: config.get('keyNamingStyle', 'snake_case'),
            openai: {
                apiKey: config.get('openai.apiKey', ''),
                model: config.get('openai.model', 'gpt-3.5-turbo'),
                enabled: config.get('openai.enabled', false)
            },
            googleSheets: {
                enabled: config.get('googleSheets.enabled', false),
                serviceAccountJson: config.get('googleSheets.serviceAccountJson', ''),
                spreadsheetId: config.get('googleSheets.spreadsheetId', '')
            }
        };
    }

    /**
     * Resolve supported languages based on preset or custom selection
     */
    private static resolveLanguages(config: vscode.WorkspaceConfiguration): string[] {
        const preset = config.get('languagePresets', 'custom') as string;
        
        switch (preset) {
            case 'europe':
                return ['en', 'tr', 'ru', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'sv'];
            
            case 'asia':
                return ['en', 'ja', 'ko', 'zh', 'hi', 'th', 'vi', 'id'];
            
            case 'global':
                return ['en', 'tr', 'ru', 'id', 'es', 'fr', 'de', 'ja', 'ko', 'zh', 'ar', 'hi'];
            
            case 'minimal':
                return ['en', 'tr', 'ru', 'id'];
            
            case 'custom':
            default:
                return config.get('supportedLanguages', ['en', 'tr', 'ru', 'id', 'es', 'fr', 'de', 'ja', 'ko', 'zh']);
        }
    }

    /**
     * Generate translation template based on config
     */
    public static generateTemplate(key: string, config?: YerelConfig): string {
        const cfg = config || this.getConfig();
        return cfg.templateSyntax
            .replace('{func}', cfg.translationFunction)
            .replace('{key}', key);
    }

    /**
     * Convert key to specified naming convention
     */
    public static formatKey(text: string, style?: string): string {
        const namingStyle = style || this.getConfig().keyNamingStyle;
        
        // Clean and normalize text
        let cleanText = text
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(word => word.length > 2) // Only words longer than 2 chars
            .filter(word => !this.isStopWord(word)); // Remove common stop words

        // If no meaningful words left, use first few characters
        if (cleanText.length === 0) {
            cleanText = [text.toLowerCase().replace(/[^a-zA-Z0-9]/g, '').substring(0, 8)];
        }

        // Limit to maximum 2 words for shorter keys
        cleanText = cleanText.slice(0, 2);

        // If we have only one word and it's too long, shorten it
        if (cleanText.length === 1 && cleanText[0].length > 8) {
            cleanText[0] = cleanText[0].substring(0, 8);
        }

        switch (namingStyle) {
            case 'camelCase':
                if (cleanText.length === 0) { return ''; }
                return cleanText[0] + cleanText.slice(1).map(word => 
                    word.charAt(0).toUpperCase() + word.slice(1)
                ).join('');
            
            case 'snake_case':
                return cleanText.join('_');
            
            case 'dot.notation':
            default:
                return cleanText.join('.');
        }
    }

    /**
     * Check if word is a common stop word that should be ignored in keys
     */
    private static isStopWord(word: string): boolean {
        const stopWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'a', 'an'];
        return stopWords.includes(word.toLowerCase());
    }

    /**
     * Get workspace root path
     */
    public static getWorkspaceRoot(): string | undefined {
        const workspaces = vscode.workspace.workspaceFolders;
        return workspaces && workspaces.length > 0 ? workspaces[0].uri.fsPath : undefined;
    }

    /**
     * Get full locales path based on user config or workspace root
     */
    public static getLocalesFullPath(currentFileUri?: vscode.Uri): string | undefined {
        const config = this.getConfig();
        // Eğer ayarda localesPath varsa onu kullan, yoksa 'locales' olarak varsay
        const localesPath = config.localesPath || 'locales';

        // Her zaman workspace root'u baz al
        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) { return undefined; }
        return vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), localesPath).fsPath;
    }
}
