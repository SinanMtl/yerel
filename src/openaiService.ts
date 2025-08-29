import { ConfigManager } from './configManager';

export interface TranslationRequest {
  text: string;
  fromLanguage: string;
  toLanguage: string;
  context?: string;
}

export interface TranslationResponse {
  translatedText: string;
  success: boolean;
  error?: string;
}

export class OpenAIService {
  private static readonly OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

  /**
   * Check if OpenAI integration is properly configured
   */
  public static isConfigured(): boolean {
    const config = ConfigManager.getConfig();
    return !!(config.openai?.enabled && config.openai?.apiKey && config.openai.apiKey.trim().length > 0);
  }

  /**
   * Translate text using OpenAI
   */
  public static async translateText(request: TranslationRequest): Promise<TranslationResponse> {
    if (!this.isConfigured()) {
      return {
        translatedText: request.text,
        success: false,
        error: 'OpenAI is not configured. Please check your settings.'
      };
    }

    const config = ConfigManager.getConfig();
    const apiKey = config.openai?.apiKey;
    const model = config.openai?.model || 'gpt-3.5-turbo';

    try {
      const systemPrompt = this.generateSystemPrompt(request.fromLanguage, request.toLanguage);
      const userPrompt = this.generateUserPrompt(request.text, request.context);

      const response = await fetch(this.OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 500,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as any;
        throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;
      const translatedText = data.choices[0]?.message?.content?.trim();

      if (!translatedText) {
        throw new Error('No translation received from OpenAI');
      }

      return {
        translatedText: this.cleanTranslation(translatedText),
        success: true
      };

    } catch (error) {
      console.error('OpenAI translation error:', error);
      return {
        translatedText: request.text,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Translate multiple languages in one API call (much faster and cheaper)
   */
  public static async translateToMultipleLanguages(
    text: string,
    targetLanguages: string[]
  ): Promise<Record<string, string>> {
    if (!this.isConfigured()) {
      const fallback: Record<string, string> = {};
      for (const lang of targetLanguages) {
        fallback[lang] = text;
      }
      return fallback;
    }

    const config = ConfigManager.getConfig();
    const apiKey = config.openai?.apiKey;
    const model = config.openai?.model || 'gpt-3.5-turbo';

    try {
      const languageNames = this.getLanguageNames();
      const systemPrompt = `You are a professional translator. Translate the given text to multiple languages simultaneously.

Rules:
- Return ONLY a valid JSON object
- Each language code should be a key with the translation as value
- Maintain original meaning and context
- Preserve special formatting, quotes, and placeholders
- Use natural, user-friendly language for UI text
- No explanations, just the JSON

Example format:
{
  "tr": "Turkish translation here",
  "ru": "Russian translation here"
}`;

      const userPrompt = `Translate this text: "${text}"

Target languages and their codes:
${targetLanguages.map(code => `${code}: ${languageNames[code] || code}`).join('\n')}

Return translations in JSON format with language codes as keys.`;

      const response = await fetch(this.OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1000,
          temperature: 0.2
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as any;
        throw new Error(`OpenAI API error: ${errorData.error?.message || response.statusText}`);
      }

      const data = await response.json() as any;
      const translationsText = data.choices[0]?.message?.content?.trim();

      if (!translationsText) {
        throw new Error('No translation received from OpenAI');
      }

      // Parse JSON response
      let translations: Record<string, string>;
      try {
        translations = JSON.parse(translationsText);
      } catch (parseError) {
        console.warn('Failed to parse OpenAI JSON response:', translationsText);
        // Fallback to original text for all languages
        const fallback: Record<string, string> = {};
        for (const lang of targetLanguages) {
          fallback[lang] = text;
        }
        return fallback;
      }

      // Validate and clean translations
      const result: Record<string, string> = {};
      for (const lang of targetLanguages) {
        if (translations[lang] && typeof translations[lang] === 'string') {
          result[lang] = this.cleanTranslation(translations[lang]);
        } else {
          console.warn(`Missing translation for ${lang}, using original text`);
          result[lang] = text;
        }
      }

      return result;

    } catch (error) {
      console.error('OpenAI batch translation error:', error);
      // Fallback to original text for all languages
      const fallback: Record<string, string> = {};
      for (const lang of targetLanguages) {
        fallback[lang] = text;
      }
      return fallback;
    }
  }

  /**
   * Get language names mapping
   */
  private static getLanguageNames(): Record<string, string> {
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

  /**
   * Generate system prompt for translation
   */
  private static generateSystemPrompt(fromLanguage: string, toLanguage: string): string {
    const languageNames = this.getLanguageNames();
    const fromLang = languageNames[fromLanguage] || fromLanguage;
    const toLang = languageNames[toLanguage] || toLanguage;

    return `You are a professional translator. Translate text from ${fromLang} to ${toLang}.

Rules:
- Maintain the original meaning and context
- Preserve any special formatting, quotes, or placeholders
- Keep the tone and style appropriate for user interfaces
- Return ONLY the translated text, no explanations
- If the text contains special characters like quotes, preserve them exactly
- For UI text, use natural and user-friendly language`;
  }

  /**
   * Generate user prompt with context
   */
  private static generateUserPrompt(text: string, context?: string): string {
    let prompt = `Translate this text: "${text}"`;

    if (context) {
      prompt += `\n\nContext: This text appears in ${context}`;
    }

    return prompt;
  }

  /**
   * Clean the translation response
   */
  private static cleanTranslation(translation: string): string {
    // Remove any quotes that might have been added by the AI
    return translation
      .replace(/^["']|["']$/g, '')  // Remove leading/trailing quotes
      .trim();
  }

  /**
   * Test the OpenAI connection
   */
  public static async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.translateText({
        text: 'Hello',
        fromLanguage: 'en',
        toLanguage: 'tr'
      });

      return {
        success: result.success,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
