import * as vscode from 'vscode';
import { ExtractableString, ExtractResult } from './types';

export class StringDetector {
    
    /**
     * Detect extractable strings in a document
     */
    public detectStrings(document: vscode.TextDocument): ExtractResult {
        const fileExtension = this.getFileExtension(document.fileName);
        const content = document.getText();
        const strings: ExtractableString[] = [];

        switch (fileExtension) {
            case 'html':
            case 'vue':
                // For HTML files, detect both HTML strings AND JavaScript within script tags
                strings.push(...this.detectHtmlStrings(content, document));
                strings.push(...this.detectJavaScriptInHtml(content, document));
                break;
            case 'js':
            case 'ts':
            case 'jsx':
            case 'tsx':
                strings.push(...this.detectJavaScriptStrings(content, document));
                break;
            default:
                // Try to detect both HTML and JS patterns
                strings.push(...this.detectHtmlStrings(content, document));
                strings.push(...this.detectJavaScriptStrings(content, document));
        }

        return {
            strings: strings.filter(s => this.isValidString(s.text)),
            totalFound: strings.length
        };
    }

    /**
     * Detect strings in HTML content
     */
    private detectHtmlStrings(content: string, document: vscode.TextDocument): ExtractableString[] {
        const strings: ExtractableString[] = [];
        
        // Pattern for text content inside HTML tags
        // Matches: <tag>Some text here</tag>
        const htmlTextRegex = />([^<>]+)</g;
        
        let match;
        while ((match = htmlTextRegex.exec(content)) !== null) {
            const text = match[1].trim();
            if (text && !this.isIgnorableText(text)) {
                const position = document.positionAt(match.index + 1);
                const endPosition = document.positionAt(match.index + match[0].length - 1);
                
                strings.push({
                    text: text,
                    startPosition: match.index + 1,
                    endPosition: match.index + match[0].length - 1,
                    lineNumber: position.line,
                    columnStart: position.character,
                    columnEnd: endPosition.character,
                    context: 'html',
                    suggestedKey: this.generateKey(text)
                });
            }
        }

        // Pattern for attribute values
        // Matches: placeholder="Some text", title="Some text", etc.
        const attrRegex = /(?:placeholder|title|alt|aria-label|data-tooltip)\s*=\s*["']([^"']+)["']/g;
        
        while ((match = attrRegex.exec(content)) !== null) {
            const text = match[1].trim();
            if (text && !this.isIgnorableText(text)) {
                const position = document.positionAt(match.index + match[0].indexOf(text));
                const endPosition = document.positionAt(match.index + match[0].indexOf(text) + text.length);
                
                strings.push({
                    text: text,
                    startPosition: match.index + match[0].indexOf(text),
                    endPosition: match.index + match[0].indexOf(text) + text.length,
                    lineNumber: position.line,
                    columnStart: position.character,
                    columnEnd: endPosition.character,
                    context: 'html',
                    suggestedKey: this.generateKey(text)
                });
            }
        }

        return strings;
    }

    /**
     * Detect JavaScript strings within HTML script tags
     */
    private detectJavaScriptInHtml(content: string, document: vscode.TextDocument): ExtractableString[] {
        const strings: ExtractableString[] = [];
        
        // Find all script tags
        const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
        let scriptMatch;
        
        while ((scriptMatch = scriptRegex.exec(content)) !== null) {
            const scriptContent = scriptMatch[1];
            const scriptStartOffset = scriptMatch.index + scriptMatch[0].indexOf('>') + 1;
            
            // Process each line of the script content
            const scriptLines = scriptContent.split('\n');
            let currentOffset = scriptStartOffset;
            
            for (let i = 0; i < scriptLines.length; i++) {
                const line = scriptLines[i];
                const globalLineIndex = document.positionAt(currentOffset).line;
                
                // Skip code lines
                if (this.isCodeLine(line)) {
                    // Skip this line
                } else {
                    // Extract strings from this line
                    this.extractStringsFromLine(line, globalLineIndex, document, strings);
                }
                
                currentOffset += line.length + 1; // +1 for newline
            }
        }
        
        return strings;
    }

    /**
     * Detect strings in JavaScript/TypeScript content
     */
    private detectJavaScriptStrings(content: string, document: vscode.TextDocument): ExtractableString[] {
        const strings: ExtractableString[] = [];
        const lines = content.split('\n');
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            
            // Skip import statements, comments, and other code patterns
            if (this.isCodeLine(line)) {
                continue;
            }
            
            // Find string literals in this line
            this.extractStringsFromLine(line, lineIndex, document, strings);
        }

        return strings;
    }

    /**
     * Check if line contains code that should be ignored
     */
    private isCodeLine(line: string): boolean {
        const trimmed = line.trim();
        
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
            return true;
        }
        
        // Skip import/export statements
        if (trimmed.startsWith('import ') || trimmed.startsWith('export ') || trimmed.includes('from ')) {
            return true;
        }
        
        // Skip variable declarations that look like CONSTANTS (all uppercase)
        if (/^(const|let|var)\s+[A-Z_]+\s*=/.test(trimmed)) {
            return true;
        }
        
        return false;
    }

    /**
     * Check if string content looks like code rather than natural language
     */
    private looksLikeCode(text: string): boolean {
        // URLs
        if (/^https?:\/\//.test(text)) { return true; }
        
        // Paths
        if (/^[\.\/\\]/.test(text)) { return true; }
        
        // File extensions
        if (/\.\w{2,4}$/.test(text)) { return true; }
        
        // Short identifiers or IDs (but allow longer descriptive text)
        if (text.length < 4 && !/\s/.test(text)) { return true; }
        
        // All uppercase (constants)
        if (/^[A-Z_]+$/.test(text)) { return true; }
        
        // camelCase or snake_case identifiers (but not if they contain spaces)
        if (!text.includes(' ') && (/^[a-z]+[A-Z]/.test(text) || /^[a-z]+_[a-z]+$/.test(text))) { 
            return true; 
        }
        
        // Common short values that are likely config
        const configValues = ['true', 'false', 'null', 'undefined', 'json', 'xml', 'css', 'js', 'ts'];
        if (configValues.includes(text.toLowerCase())) { return true; }
        
        return false;
    }

    /**
     * Extract string literals from a single line
     */
    private extractStringsFromLine(line: string, lineIndex: number, document: vscode.TextDocument, strings: ExtractableString[]): void {
        // Simple regex to find quoted strings
        const quotedStrings = /(['"`])((?:(?!\1)[^\\]|\\.)*)(\1)/g;
        
        let match;
        while ((match = quotedStrings.exec(line)) !== null) {
            const text = match[2]; // Content inside quotes
            
            // Skip if this looks like code or should be ignored
            if (this.looksLikeCode(text) || this.isIgnorableText(text)) {
                continue;
            }
            
            // Only include strings that look like natural language
            if (this.isNaturalLanguage(text)) {
                const lineStartOffset = document.offsetAt(new vscode.Position(lineIndex, 0));
                
                // For JavaScript, we need to replace the entire quoted string including quotes
                const matchStartInLine = match.index; // Include opening quote
                const matchEndInLine = match.index + match[0].length; // Include closing quote
                const startPosition = lineStartOffset + matchStartInLine;
                const endPosition = lineStartOffset + matchEndInLine;
                
                strings.push({
                    text: text,
                    startPosition: startPosition,
                    endPosition: endPosition,
                    lineNumber: lineIndex,
                    columnStart: matchStartInLine,
                    columnEnd: matchEndInLine,
                    context: 'javascript',
                    suggestedKey: this.generateKey(text)
                });
            }
        }
    }

    /**
     * Check if text looks like natural language
     */
    private isNaturalLanguage(text: string): boolean {
        // Must contain at least one space or be a meaningful sentence
        if (text.includes(' ')) { return true; }
        
        // Or be a longer single word that makes sense
        if (text.length > 6 && /^[a-zA-Z]+$/.test(text)) { return true; }
        
        // Or contain punctuation suggesting it's a sentence
        if (/[.!?,:;]/.test(text)) { return true; }
        
        return false;
    }

    /**
     * Check if text should be ignored
     */
    private isIgnorableText(text: string): boolean {
        // Ignore whitespace-only, very short strings, URLs, file paths, etc.
        if (text.length < 3) { return true; } // Increased minimum length
        if (!/\S/.test(text)) { return true; } // Only whitespace
        if (/^[\d\s\-+.,:;!?()[\]{}]+$/.test(text)) { return true; } // Only numbers and punctuation
        if (/^https?:\/\//.test(text)) { return true; } // URLs
        if (/^[a-zA-Z]:[\\\/]/.test(text)) { return true; } // Windows paths
        if (/^[\/\\]/.test(text)) { return true; } // Unix paths
        if (/^[a-z]+[A-Z]/.test(text) && text.length < 15) { return true; } // camelCase variables
        if (/^[A-Z_]+$/.test(text)) { return true; } // CONSTANTS
        if (/^[a-z]+$/.test(text) && text.length < 5) { return true; } // Short single words
        if (/^\w+$/.test(text) && !text.includes(' ')) { return true; } // Single words without spaces
        
        return false;
    }

    /**
     * Check if string is valid for extraction
     */
    private isValidString(text: string): boolean {
        return !this.isIgnorableText(text) && 
               text.length >= 2 && 
               /[a-zA-ZğüşıöçĞÜŞIÖÇа́-я́ё́А́-Я́Ё́]/.test(text); // Contains letters
    }

    /**
     * Check if position is inside an import statement
     */
    private isInImportStatement(content: string, position: number): boolean {
        const lineStart = content.lastIndexOf('\n', position);
        const lineEnd = content.indexOf('\n', position);
        const line = content.substring(lineStart + 1, lineEnd === -1 ? content.length : lineEnd);
        
        return /^\s*import\s/.test(line) || /^\s*from\s/.test(line);
    }

    /**
     * Generate a suggested key from text
     */
    private generateKey(text: string): string {
        // Simple key generation - can be improved
        return text
            .toLowerCase()
            .replace(/[^a-zA-Z0-9\s]/g, '')
            .trim()
            .split(/\s+/)
            .filter(word => word.length > 0)
            .slice(0, 3) // Take first 3 words
            .join('.');
    }

    /**
     * Get file extension
     */
    private getFileExtension(fileName: string): string {
        const parts = fileName.split('.');
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
    }
}
