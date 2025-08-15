export interface ExtractableString {
    text: string;
    startPosition: number;
    endPosition: number;
    lineNumber: number;
    columnStart: number;
    columnEnd: number;
    context: 'html' | 'javascript' | 'template';
    suggestedKey?: string;
}

export interface ExtractResult {
    strings: ExtractableString[];
    totalFound: number;
}

export interface YerelConfig {
    translationFunction: string;
    templateSyntax: string;
    localesPath: string;
    supportedLanguages: string[];
    keyNamingStyle: 'camelCase' | 'snake_case' | 'dot.notation';
}

export interface TranslationEntry {
    key: string;
    translations: Record<string, string>;
}
