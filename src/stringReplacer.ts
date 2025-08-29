declare global {
  var __yerelKeyValueMap: Record<string, string> | undefined;
}

import * as vscode from 'vscode';
import * as path from 'path';
import { ExtractedText } from '@sinanmtl/doc-parser';
import { TranslationEntry } from './types';
import { ConfigManager } from './configManager';
import { LocaleManager } from './localeManager';

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
      const translationEntries: TranslationEntry[] = [];
      const edits: vscode.WorkspaceEdit = new vscode.WorkspaceEdit();

      // Sort strings by position (reverse order to maintain correct positions during replacement)
      const sortedStrings = [...strings].sort((a, b) => b.absoluteStart - a.absoluteStart);

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
        const finalActualText = document.getText(range);
        if (finalActualText !== str.text && !this.isTextWithQuotes(finalActualText, str.text)) {
          console.warn(`Text mismatch for key "${uniqueKey}":`, {
            expected: str.text,
            actual: finalActualText,
            range: range.toString(),
            startPos,
            endPos
          });
          // Continue anyway, but this might indicate a problem
        }

        edits.replace(document.uri, range, replacementText);
      }

      // Validate that we have edits to apply
      if (edits.size === 0) {
        throw new Error('No valid edits were generated. Check that the selected strings are still valid in the document.');
      }

      progress.report({
        increment: 25,
        message: 'Applying text changes...'
      });

      // Apply all edits with detailed error handling
      try {
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
}
