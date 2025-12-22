export interface YerelConfig {
  translationFunction: string;
  templateSyntax: string;
  localesPath: string;
  supportedLanguages: string[];
  keyNamingStyle: 'camelCase' | 'snake_case' | 'dot.notation';
  openai?: {
    apiKey?: string;
    model?: string;
    enabled?: boolean;
  };
  googleSheets?: {
    enabled?: boolean;
    serviceAccountJson?: string;
    spreadsheetId?: string;
  };
}

export interface TranslationEntry {
  key: string;
  translations: Record<string, string>;
}
