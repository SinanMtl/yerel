import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './configManager';
import { OpenAIService } from './openaiService';
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
        const updatedLanguages: string[] = [];
        
        // Process each language
        for (const lang of config.supportedLanguages) {
            const filePath = path.join(localesPath, `${lang}.json`);
            try {
                await this.updateLocaleFile(filePath, entries, lang);
                updatedLanguages.push(lang);
            } catch (error) {
                throw new Error(`Failed to update ${lang}.json: ${error}`);
            }
        }

        // Show comprehensive success message
        const languageNames = this.getLanguageDisplayNames();
        const languageList = updatedLanguages.map(code => 
            `${languageNames[code] || code} (${code})`
        ).join(', ');

        vscode.window.showInformationMessage(
            `🎉 Updated ${entries.length} translation(s) in ${updatedLanguages.length} languages: ${languageList}`
        );
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
            // Use flat key assignment instead of nested structure
            existingTranslations[entry.key] = translation;
        }

                // Write updated translations
        const sortedTranslations = this.sortObjectKeys(existingTranslations);
        const content = JSON.stringify(sortedTranslations, null, 2);
        
        try {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log(`Successfully updated ${path.basename(filePath)} with ${entries.length} translation(s)`);
        } catch (error) {
            throw new Error(`Failed to write file ${filePath}: ${error}`);
        }
    }

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
        const updatedLanguages: string[] = [];
        
        // Process each language
        for (const lang of config.supportedLanguages) {
            const filePath = path.join(localesPath, `${lang}.json`);
            try {
                await this.updateLocaleFile(filePath, entries, lang);
                updatedLanguages.push(lang);
            } catch (error) {
                throw new Error(`Failed to update ${lang}.json: ${error}`);
            }
        }

        // Show comprehensive success message
        const languageNames = this.getLanguageDisplayNames();
        const languageList = updatedLanguages.map(code => 
            `${languageNames[code] || code} (${code})`
        ).join(', ');

        vscode.window.showInformationMessage(
            `🎉 Updated ${entries.length} translation(s) in ${updatedLanguages.length} languages: ${languageList}`
        );
    }

    /**
     * Get display names for languages
     */
    private static getLanguageDisplayNames(): Record<string, string> {
        return {
            'en': 'English',
            'tr': 'Turkish', 
            'ru': 'Russian',
            'id': 'Indonesian',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'ja': 'Japanese',
            'ko': 'Korean',
            'zh': 'Chinese',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ar': 'Arabic',
            'hi': 'Hindi',
            'th': 'Thai',
            'vi': 'Vietnamese',
            'nl': 'Dutch',
            'pl': 'Polish',
            'sv': 'Swedish',
            'da': 'Danish',
            'no': 'Norwegian',
            'fi': 'Finnish',
            'cs': 'Czech',
            'hu': 'Hungarian',
            'ro': 'Romanian',
            'bg': 'Bulgarian',
            'hr': 'Croatian',
            'sk': 'Slovak',
            'sl': 'Slovenian',
            'et': 'Estonian',
            'lv': 'Latvian',
            'lt': 'Lithuanian',
            'uk': 'Ukrainian',
            'be': 'Belarusian',
            'kk': 'Kazakh',
            'uz': 'Uzbek',
            'ky': 'Kyrgyz',
            'tg': 'Tajik',
            'mn': 'Mongolian',
            'ka': 'Georgian',
            'hy': 'Armenian',
            'az': 'Azerbaijani'
        };
    }
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
    public static async generateTranslations(originalText: string, key: string): Promise<TranslationEntry> {
        const config = ConfigManager.getConfig();
        const translations: Record<string, string> = {};
        
        // Set English as the base language
        translations['en'] = originalText;
        
        // If OpenAI is enabled, translate to other languages in one API call
        if (config.openai?.enabled && OpenAIService.isConfigured()) {
            console.log('🤖 OpenAI enabled, generating batch translations...');
            
            // Get target languages (exclude English)
            const targetLanguages = config.supportedLanguages.filter(lang => lang !== 'en');
            
            if (targetLanguages.length > 0) {
                // Show progress indicator while translating
                const batchTranslations = await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `🤖 Translating "${originalText.substring(0, 30)}${originalText.length > 30 ? '...' : ''}"`,
                    cancellable: false
                }, async (progress) => {
                    progress.report({ 
                        increment: 0, 
                        message: `to ${targetLanguages.length} languages using OpenAI...` 
                    });

                    try {
                        const result = await OpenAIService.translateToMultipleLanguages(
                            originalText, 
                            targetLanguages
                        );
                        
                        progress.report({ 
                            increment: 100, 
                            message: '✅ Translations completed!' 
                        });
                        
                        return result;
                        
                    } catch (error) {
                        progress.report({ 
                            increment: 100, 
                            message: '❌ Translation failed, using fallback...' 
                        });
                        
                        console.error('Error in batch translation:', error);
                        // Fallback to original text for all languages
                        const fallback: Record<string, string> = {};
                        for (const lang of targetLanguages) {
                            fallback[lang] = originalText;
                        }
                        return fallback;
                    }
                });
                
                // Merge batch translations
                Object.assign(translations, batchTranslations);
                
                console.log(`✅ Batch translated to ${targetLanguages.length} languages:`, batchTranslations);
            }
        } else {
            // No OpenAI, use original text for all languages
            for (const lang of config.supportedLanguages) {
                if (lang !== 'en') {
                    translations[lang] = originalText;
                }
            }
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
                    
                    // Check for flat key existence
                    if (translations.hasOwnProperty(key)) {
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

    /**
     * Get display names for languages
     */
    private static getLanguageDisplayNames(): Record<string, string> {
        return {
            'en': 'English',
            'tr': 'Turkish', 
            'ru': 'Russian',
            'id': 'Indonesian',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'ja': 'Japanese',
            'ko': 'Korean',
            'zh': 'Chinese',
            'it': 'Italian',
            'pt': 'Portuguese',
            'ar': 'Arabic',
            'hi': 'Hindi',
            'th': 'Thai',
            'vi': 'Vietnamese',
            'nl': 'Dutch',
            'pl': 'Polish',
            'sv': 'Swedish',
            'da': 'Danish',
            'no': 'Norwegian',
            'fi': 'Finnish',
            'cs': 'Czech',
            'hu': 'Hungarian',
            'ro': 'Romanian',
            'bg': 'Bulgarian',
            'hr': 'Croatian',
            'sk': 'Slovak',
            'sl': 'Slovenian',
            'et': 'Estonian',
            'lv': 'Latvian',
            'lt': 'Lithuanian',
            'uk': 'Ukrainian',
            'be': 'Belarusian',
            'kk': 'Kazakh',
            'uz': 'Uzbek',
            'ky': 'Kyrgyz',
            'tg': 'Tajik',
            'mn': 'Mongolian',
            'ka': 'Georgian',
            'hy': 'Armenian',
            'az': 'Azerbaijani'
        };
    }
}
