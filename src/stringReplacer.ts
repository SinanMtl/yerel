declare global {
  var __yerelKeyValueMap: Record<string, string> | undefined;
}

import * as vscode from 'vscode';
import * as path from 'path';
import { ExtractedText } from '@sinanmtl/doc-parser';
import { TranslationEntry } from './types';
import { ConfigManager } from './configManager';
import { LocaleManager } from './localeManager';
import { OpenAIService } from './openaiService';

export class StringReplacer {
  /**
   * Generate key with file path information
   */
  private static generateKeyWithPath(text: string, documentUri: vscode.Uri): string {
    const workspaceRoot = ConfigManager.getWorkspaceRoot();

    // Get relative path from workspace root
    let relativePath = '';
    if (workspaceRoot) {
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
    strings: ExtractedText[],
    document: vscode.TextDocument
  ): Promise<void> {
    const config = ConfigManager.getConfig();
    
    // Show overall progress for the entire extraction process
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `🌍 Extracting ${strings.length} string(s) to i18n`,
      cancellable: false
    }, async (progress) => {
      const edits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();

      // Sort strings by position (reverse order to maintain correct positions during replacement)
      const sortedStrings = [...strings].sort((a, b) => b.absoluteStart - a.absoluteStart);

      progress.report({
        increment: 10,
        message: 'Generating unique keys...'
      });

      // Step 1: Generate unique keys for all strings
      const keyValuePairs: Record<string, string> = {};
      
      // Batch içi key-value eşleşmelerini kontrol etmek için static bir map
      if (!globalThis.__yerelKeyValueMap) {
        globalThis.__yerelKeyValueMap = {};
      }
      const keyValueMap = globalThis.__yerelKeyValueMap;

      for (const str of sortedStrings) {
        // Generate unique key with file path
        const baseKey = this.generateKeyWithPath(str.text, document.uri);
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
        keyValuePairs[uniqueKey] = str.text;
      }

      progress.report({
        increment: 20,
        message: 'Translating to all languages using OpenAI...'
      });

      // Step 2: Batch translate all key-value pairs if OpenAI is enabled
      const translationsByLanguage: Record<string, Record<string, any>> = {};
      
      if (config.openai?.enabled && OpenAIService.isConfigured()) {
        const targetLanguages = config.supportedLanguages.filter(lang => lang !== 'en');
        
        // Translate to each language using batch API
        for (const targetLang of targetLanguages) {
          try {
            console.log(`Translating batch to ${targetLang}...`, keyValuePairs);
            const result = await OpenAIService.translateKeyValuePairs({
              entries: keyValuePairs,
              targetLanguage: targetLang,
              sourceLanguage: 'en'
            });

            if (result.success) {
              translationsByLanguage[targetLang] = result.translations;
            } else {
              console.warn(`Translation failed for ${targetLang}:`, result.error);
              
              // Show user-friendly error message for quota issues
              if (result.error?.includes('quota')) {
                vscode.window.showWarningMessage(
                  `⚠️ OpenAI quota exceeded. Using original text for ${targetLang}. Please check your billing at https://platform.openai.com/account/billing`
                );
              } else if (result.error?.includes('rate limit')) {
                vscode.window.showWarningMessage(
                  `⚠️ OpenAI rate limit exceeded. Using original text for ${targetLang}. Please try again later.`
                );
              }
              
              // Fallback: use original texts in nested format
              translationsByLanguage[targetLang] = this.convertToNestedJson(keyValuePairs);
            }
          } catch (error) {
            console.error(`Batch translation error for ${targetLang}:`, error);
            
            // Show user-friendly error message
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            if (errorMessage.includes('quota')) {
              vscode.window.showWarningMessage(
                `⚠️ OpenAI quota exceeded. Using original text for ${targetLang}. Please check your billing.`
              );
            } else if (errorMessage.includes('rate limit')) {
              vscode.window.showWarningMessage(
                `⚠️ OpenAI rate limit exceeded. Using original text for ${targetLang}. Please try again later.`
              );
            } else if (errorMessage.includes('API key')) {
              vscode.window.showErrorMessage(
                `🔑 OpenAI API key issue: ${errorMessage}`
              );
            }
            
            // Fallback: use original texts in nested format
            translationsByLanguage[targetLang] = this.convertToNestedJson(keyValuePairs);
          }
        }
      } else {
        // If OpenAI is not enabled, use original texts for all languages
        const fallbackTranslations = this.convertToNestedJson(keyValuePairs);
        for (const lang of config.supportedLanguages.filter(lang => lang !== 'en')) {
          translationsByLanguage[lang] = fallbackTranslations;
        }
      }

      // Add English translations (original texts)
      translationsByLanguage['en'] = this.convertToNestedJson(keyValuePairs);

      console.log('Translations by language:', translationsByLanguage);

      progress.report({
        increment: 30,
        message: 'Preparing text replacements...'
      });

      // Step 3: Create text edits for all strings
      for (const str of sortedStrings) {
        const uniqueKey = Object.keys(keyValuePairs).find(key => keyValuePairs[key] === str.text);
        if (!uniqueKey) {
          continue;
        }

        // Generate replacement text based on context
        const replacementText = this.generateReplacementText(uniqueKey, str, config, document);

        // Handle Vue attribute transformation if needed
        if (str.context === 'vue' && this.isInsideAttribute(str, document)) {
          this.handleVueAttributeTransformation(str, document, edits);
        }

        // Create text edit with validation
        let startPos = document.positionAt(str.absoluteStart);
        let endPos = document.positionAt(str.absoluteEnd);
        
        // Check if the text to be replaced is surrounded by quotes and extend the range to include them
        // Only apply quote removal for JavaScript context
        const documentText = document.getText();
        
        if (str.context === 'javascript') {
          // Check characters before and after the selected text to see if they are quotes
          const charBefore = str.absoluteStart > 0 ? documentText[str.absoluteStart - 1] : '';
          const charAfter = str.absoluteEnd < documentText.length ? documentText[str.absoluteEnd] : '';
          
          // If the text is surrounded by matching quotes, extend the range to include them
          if ((charBefore === '"' && charAfter === '"') || 
              (charBefore === "'" && charAfter === "'") || 
              (charBefore === '`' && charAfter === '`')) {
            // Extend range to include the quotes
            startPos = document.positionAt(str.absoluteStart - 1);
            endPos = document.positionAt(str.absoluteEnd + 1);
          }
        }
        
        // Validate positions
        if (str.startPosition < 0 || str.endPosition < 0 || str.startPosition > str.endPosition) {
          console.error(`Invalid string positions for "${str.text}":`, {
            startPosition: str.startPosition,
            endPosition: str.endPosition,
            absoluteStart: str.absoluteStart,
            documentLength: document.getText().length
          });
          continue; // Skip this edit
        }

        // Validate that positions are within document bounds
        if (str.endPosition > documentText.length) {
          console.error(`String position exceeds document length for "${str.text}":`, {
            endPosition: str.endPosition,
            documentLength: documentText.length
          });
          continue; // Skip this edit
        }

        const range = new vscode.Range(startPos, endPos);
        
        // Validate the range
        /* const finalActualText = document.getText(range);
        if (finalActualText !== str.text && !this.isTextWithQuotes(finalActualText, str.text)) {
          console.warn(`Text mismatch for key "${uniqueKey}":`, {
            expected: str.text,
            actual: finalActualText,
            range: range.toString(),
            startPos,
            endPos
          });
          // Continue anyway, but this might indicate a problem
        } */

        edits.replace(document.uri, range, replacementText);
      }

      // Validate that we have edits to apply
      if (edits.size === 0) {
        throw new Error('No valid edits were generated. Check that the selected strings are still valid in the document.');
      }

      progress.report({
        increment: 20,
        message: 'Applying text changes...'
      });

      // Step 4: Apply all edits
      try {
        const success = await vscode.workspace.applyEdit(edits);

        if (success) {
          progress.report({
            increment: 15,
            message: 'Saving translation files...'
          });

          // Convert translationsByLanguage to TranslationEntry array for compatibility
          const translationEntries = this.convertToTranslationEntries(translationsByLanguage);

          // Step 5: Save all translations to locale files at once
          await this.saveBatchTranslations(translationsByLanguage, document.uri);
          
          await LocaleManager.exportToGoogleSheetsIfEnabled(translationEntries);

          // Complete the progress to 100%
          progress.report({
            increment: 5,
            message: 'Completed successfully!'
          });
        } else {
          // Log detailed information about the failed edit
          console.error('WorkspaceEdit failed. Edit details:', {
            documentUri: document.uri.toString(),
            documentVersion: document.version,
            isDocumentDirty: document.isDirty,
            editCount: edits.size,
            editsPerFile: Array.from(edits.entries()).map(([uri, edits]) => ({
              uri: uri.toString(),
              editCount: edits.length
            }))
          });

          // Check if document is still valid
          const currentDoc = vscode.workspace.textDocuments.find(doc => 
            doc.uri.toString() === document.uri.toString()
          );
          
          if (!currentDoc) {
            throw new Error('Document was closed or deleted during the edit operation');
          }
          
          if (currentDoc.version !== document.version) {
            throw new Error('Document was modified during the edit operation. Please try again.');
          }

          throw new Error('Failed to apply text edits. The document may be read-only or the edits are conflicting.');
        }
      } catch (error) {
        console.error('Error during applyEdit:', error);
        throw error;
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
    str: ExtractedText,
    config: any,
    document?: vscode.TextDocument
  ): string {
    const func = config.translationFunction;

    switch (str.context) {
      case 'html':
        // Check if this is actually JSX (HTML context in .jsx/.tsx files)
        if (this.isJSXContext(document)) {
          // For JSX contexts with HTML context
          if (document && this.isInsideAttribute(str, document)) {
            // For JSX attributes, use {$t('key')} format
            return `{${func}('${key}')}`;
          } else {
            // For JSX content, use {$t('key')} instead of {{ }}
            return `{${func}('${key}')}`;
          }
        } else {
          // For regular HTML context, use template syntax
          return ConfigManager.generateTemplate(key, config);
        }

      case 'javascript':
        // For JavaScript context, determine if it's in a string literal or template
        return `${func}('${key}')`;

      case 'vue':
        // Check if this is inside an attribute
        if (document && this.isInsideAttribute(str, document)) {
          // For Vue attributes, use :attribute="$t('key')" format (no curly braces)
          return `${func}('${key}')`;
        } else {
          // For Vue template content, use {{ $t('key') }}
          return ConfigManager.generateTemplate(key, config);
        }

      default:
        // Handle JSX/TSX and other contexts
        const isJSX = this.isJSXContext(document);
        
        if (isJSX) {
          // For JSX contexts
          if (document && this.isInsideAttribute(str, document)) {
            // For JSX attributes, use {$t('key')} format
            return `{${func}('${key}')}`;
          } else {
            // For JSX content (HTML text), use {$t('key')} instead of {{ }}
            return `{${func}('${key}')}`;
          }
        } else {
          // For other contexts, check if inside attribute
          if (document && this.isInsideAttribute(str, document)) {
            // For attributes in other contexts, use {$t('key')} format
            return `{${func}('${key}')}`;
          } else {
            return ConfigManager.generateTemplate(key, config);
          }
        }
    }
  }

  /**
   * Check if we're in a JSX/TSX context
   */
  private static isJSXContext(document?: vscode.TextDocument): boolean {
    if (document) {
      const fileName = document.fileName;
      const isJSXFile = fileName.endsWith('.jsx') || fileName.endsWith('.tsx');
      
      return isJSXFile;
    }
    return false;
  }

  /**
   * Check if the extracted text is inside an HTML/Vue/JSX attribute
   */
  private static isInsideAttribute(str: ExtractedText, document: vscode.TextDocument): boolean {
    const documentText = document.getText();
    
    // Use the actual position from the document instead of line-based calculation
    const startPos = str.absoluteStart;
    const endPos = str.absoluteEnd;
    
    // Get more context around the string (50 chars before and after)
    const contextStart = Math.max(0, startPos - 50);
    const contextEnd = Math.min(documentText.length, endPos + 50);
    const fullContext = documentText.substring(contextStart, contextEnd);
    
    // Find where our text starts in this context
    const textStartInContext = startPos - contextStart;
    const beforeText = fullContext.substring(0, textStartInContext);
    const afterText = fullContext.substring(textStartInContext + str.text.length);
    
    // Look for = before our position and closing quote after
    const hasEqualsBefore = /\w+\s*=\s*["'`][^"'`]*$/.test(beforeText);
    const hasClosingQuoteAfter = /^[^"'`]*["'`]/.test(afterText);
    
    return hasEqualsBefore && hasClosingQuoteAfter;
  }

  /**
   * Handle Vue attribute transformation (add colon prefix)
   */
  private static handleVueAttributeTransformation(
    str: ExtractedText,
    document: vscode.TextDocument,
    edits: vscode.WorkspaceEdit
  ): void {
    const documentText = document.getText();
    
    // Use the same context-based approach as isInsideAttribute
    const startPos = str.absoluteStart;
    
    // Get more context around the string (100 chars before should be enough to find the attribute)
    const contextStart = Math.max(0, startPos - 100);
    const fullContext = documentText.substring(contextStart, startPos);
    
    // Find the attribute name before the equals sign
    const attributeMatch = fullContext.match(/(\w+)\s*=\s*["'`][^"'`]*$/);
    if (attributeMatch) {
      const attributeName = attributeMatch[1];
      
      // Don't add colon if attribute already has it or if it's a special Vue directive
      if (!attributeName.startsWith(':') && !attributeName.startsWith('v-') && attributeName !== 'key' && attributeName !== 'ref') {
        // Find the position of the attribute name in the document
        const attributeStartInContext = fullContext.lastIndexOf(attributeName);
        const attributeAbsoluteStart = contextStart + attributeStartInContext;
        const attributePos = document.positionAt(attributeAbsoluteStart);
        
        // Add colon before the attribute name
        edits.replace(
          document.uri,
          new vscode.Range(attributePos, attributePos),
          ':'
        );
      }
    }
  }

  /**
   * Check if the actualText contains the expected text surrounded by quotes
   */
  private static isTextWithQuotes(actualText: string, expectedText: string): boolean {
    return (
      actualText === `"${expectedText}"` ||
      actualText === `'${expectedText}'` ||
      actualText === `\`${expectedText}\``
    );
  }

  /**
   * Preview replacement for a single string
   */
  public static previewReplacement(str: ExtractedText, documentUri?: vscode.Uri): string {
    const config = ConfigManager.getConfig();
    let key: string;

    if (documentUri) {
      key = this.generateKeyWithPath(str.text, documentUri);
      
      // For preview, try to get the document if available
      const document = vscode.workspace.textDocuments.find(doc => 
        doc.uri.toString() === documentUri.toString()
      );
      
      return this.generateReplacementText(key, str, config, document);
    } else {
      // Fallback to old key generation for preview
      key = ConfigManager.formatKey(str.text);
      return this.generateReplacementText(key, str, config);
    }
  }

  /**
   * Convert flat key-value pairs to nested JSON structure
   * Input: { "landing.address": "Adres", "hello.world.here": "Merhaba Dünya" }
   * Output: { landing: { address: "Adres" }, hello: { world: { here: "Merhaba Dünya" } } }
   */
  private static convertToNestedJson(flatObject: Record<string, string>): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, value] of Object.entries(flatObject)) {
      const keys = key.split('.');
      let current = result;

      // Navigate/create the nested structure
      for (let i = 0; i < keys.length - 1; i++) {
        const currentKey = keys[i];
        if (!(currentKey in current)) {
          current[currentKey] = {};
        }
        current = current[currentKey];
      }

      // Set the final value
      const finalKey = keys[keys.length - 1];
      current[finalKey] = value;
    }

    return result;
  }

  /**
   * Save batch translations to locale files
   */
  private static async saveBatchTranslations(
    translationsByLanguage: Record<string, Record<string, any>>,
    currentFileUri: vscode.Uri
  ): Promise<void> {
    const localesPath = ConfigManager.getLocalesFullPath(currentFileUri);
    if (!localesPath) {
      throw new Error('Could not determine locales path');
    }

    // Ensure locales directory exists
    await this.ensureDirectoryExists(localesPath);

    const config = ConfigManager.getConfig();

    // Process each language
    for (const lang of config.supportedLanguages) {
      if (!translationsByLanguage[lang]) {
        continue;
      }

      const filePath = path.join(localesPath, `${lang}.json`);
      try {
        await this.updateLocaleFileWithNested(filePath, translationsByLanguage[lang]);
      } catch (error) {
        throw new Error(`Failed to update ${lang}.json: ${error}`);
      }
    }
  }

  /**
   * Update locale file with nested translation data
   */
  private static async updateLocaleFileWithNested(
    filePath: string,
    newTranslations: Record<string, any>
  ): Promise<void> {
    const fs = require('fs').promises;
    
    let existingTranslations: Record<string, any> = {};

    // Read existing file if it exists
    try {
      const content = await fs.readFile(filePath, 'utf8');
      existingTranslations = JSON.parse(content);
    } catch (error) {
      // File doesn't exist or is invalid, start with empty object
      console.log(`Creating new locale file: ${filePath}`);
    }

    // Merge new translations with existing ones
    const mergedTranslations = this.deepMerge(existingTranslations, newTranslations);

    // Write back to file with pretty formatting
    await fs.writeFile(filePath, JSON.stringify(mergedTranslations, null, 2), 'utf8');
  }

  /**
   * Deep merge two objects
   */
  private static deepMerge(target: any, source: any): any {
    const result = { ...target };

    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Ensure directory exists, create if it doesn't
   */
  private static async ensureDirectoryExists(dirPath: string): Promise<void> {
    const fs = require('fs');
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Convert translationsByLanguage object to TranslationEntry array
   * Input: { "en": { "landing": { "address": "Address" } }, "tr": { "landing": { "address": "Adres" } } }
   * Output: [{ key: "landing.address", translations: { "en": "Address", "tr": "Adres" } }]
   */
  private static convertToTranslationEntries(
    translationsByLanguage: Record<string, Record<string, any>>
  ): TranslationEntry[] {
    const translationEntries: TranslationEntry[] = [];
    const flatKeys = new Set<string>();

    // First, collect all possible keys from all languages
    for (const [lang, translations] of Object.entries(translationsByLanguage)) {
      const flattenedKeys = this.flattenObject(translations);
      Object.keys(flattenedKeys).forEach(key => flatKeys.add(key));
    }

    // Then, create TranslationEntry for each key
    for (const key of flatKeys) {
      const translations: Record<string, string> = {};

      // For each language, get the translation for this key
      for (const [lang, langTranslations] of Object.entries(translationsByLanguage)) {
        const flattenedTranslations = this.flattenObject(langTranslations);
        translations[lang] = flattenedTranslations[key] || '';
      }

      translationEntries.push({
        key,
        translations
      });
    }

    return translationEntries;
  }

  /**
   * Flatten nested object to dot notation
   * Input: { "landing": { "address": "Address", "title": "Title" }, "home": "Home" }
   * Output: { "landing.address": "Address", "landing.title": "Title", "home": "Home" }
   */
  private static flattenObject(obj: Record<string, any>, prefix: string = ''): Record<string, string> {
    const flattened: Record<string, string> = {};

    for (const [key, value] of Object.entries(obj)) {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // Recursively flatten nested objects
        Object.assign(flattened, this.flattenObject(value, newKey));
      } else {
        // It's a primitive value, add it to flattened object
        flattened[newKey] = String(value);
      }
    }

    return flattened;
  }
}
