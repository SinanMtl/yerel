import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './configManager';
import { TranslationEntry } from './types';

export class LocaleManager {
    
    /**
     * Save translations to locale files
     */
    public static async saveTranslations(entries: TranslationEntry[], currentFileUri: vscode.Uri): Promise<void> {
        const localesPath = ConfigManager.getLocalesFullPath(currentFileUri);
        if (!localesPath) {
            throw new Error('Could not determine locales path');
        }

        // Ensure locales directory exists
        await this.ensureDirectoryExists(localesPath);

        const config = ConfigManager.getConfig();
        
        // Process each language
        for (const lang of config.supportedLanguages) {
            const filePath = path.join(localesPath, `${lang}.json`);
            await this.updateLocaleFile(filePath, entries, lang);
        }
    }

    /**
     * Update a specific locale file
     */
    private static async updateLocaleFile(filePath: string, entries: TranslationEntry[], language: string): Promise<void> {
        let existingTranslations: Record<string, any> = {};

        // Read existing file if it exists
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                existingTranslations = JSON.parse(content);
            } catch (error) {
                console.warn(`Failed to parse existing locale file ${filePath}:`, error);
            }
        }

        // Add new translations
        for (const entry of entries) {
            const translation = entry.translations[language] || entry.translations['en'] || entry.key;
            this.setNestedValue(existingTranslations, entry.key, translation);
        }

        // Write updated translations
        const sortedTranslations = this.sortObjectKeys(existingTranslations);
        const content = JSON.stringify(sortedTranslations, null, 2);
        
        fs.writeFileSync(filePath, content, 'utf8');
        
        vscode.window.showInformationMessage(`Updated ${language}.json with ${entries.length} translation(s)`);
    }

    /**
     * Set nested value in object using dot notation
     */
    private static setNestedValue(obj: any, key: string, value: string): void {
        const keys = key.split('.');
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            if (!(keys[i] in current) || typeof current[keys[i]] !== 'object') {
                current[keys[i]] = {};
            }
            current = current[keys[i]];
        }

        current[keys[keys.length - 1]] = value;
    }

    /**
     * Sort object keys recursively for consistent file output
     */
    private static sortObjectKeys(obj: any): any {
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            return obj;
        }

        const sortedObj: any = {};
        const sortedKeys = Object.keys(obj).sort();

        for (const key of sortedKeys) {
            sortedObj[key] = this.sortObjectKeys(obj[key]);
        }

        return sortedObj;
    }

    /**
     * Ensure directory exists, create if it doesn't
     */
    private static async ensureDirectoryExists(dirPath: string): Promise<void> {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    /**
     * Generate translations for different languages
     */
    public static generateTranslations(originalText: string, key: string): TranslationEntry {
        // Use the original text for all languages (no translation for now)
        const config = ConfigManager.getConfig();
        const translations: Record<string, string> = {};
        
        for (const lang of config.supportedLanguages) {
            translations[lang] = originalText;
        }

        return {
            key,
            translations
        };
    }

    /**
     * Check if a key already exists in any locale file
     */
    public static async keyExists(key: string, currentFileUri?: vscode.Uri): Promise<boolean> {
        const localesPath = ConfigManager.getLocalesFullPath(currentFileUri);
        if (!localesPath) { return false; }

        const config = ConfigManager.getConfig();
        
        for (const lang of config.supportedLanguages) {
            const filePath = path.join(localesPath, `${lang}.json`);
            
            if (fs.existsSync(filePath)) {
                try {
                    const content = fs.readFileSync(filePath, 'utf8');
                    const translations = JSON.parse(content);
                    
                    if (this.hasNestedKey(translations, key)) {
                        return true;
                    }
                } catch (error) {
                    // Continue checking other files
                }
            }
        }

        return false;
    }

    /**
     * Check if nested key exists in object
     */
    private static hasNestedKey(obj: any, key: string): boolean {
        const keys = key.split('.');
        let current = obj;

        for (const k of keys) {
            if (typeof current !== 'object' || current === null || !(k in current)) {
                return false;
            }
            current = current[k];
        }

        return true;
    }

    /**
     * Generate unique key if the provided key already exists
     */
    public static async generateUniqueKey(baseKey: string, currentFileUri?: vscode.Uri): Promise<string> {
        let key = baseKey;
        let counter = 1;

        while (await this.keyExists(key, currentFileUri)) {
            key = `${baseKey}${counter}`;
            counter++;
        }

        return key;
    }
}
