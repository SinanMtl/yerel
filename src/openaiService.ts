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

export interface KeyValueTranslationRequest {
  entries: Record<string, string>; // key.path.foo="text" format
  targetLanguage: string;
  sourceLanguage?: string;
}

export interface KeyValueTranslationResponse {
  translations: Record<string, any>; // nested JSON structure
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
        this.handleAPIError(response, errorData);
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
        this.handleAPIError(response, errorData);
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

  /**
   * Translate key-value pairs in batch for a specific language
   * Input format: { "landing.address": "Address", "landing.our": "Our Services" }
   * Output format: nested JSON structure
   */
  public static async translateKeyValuePairs(request: KeyValueTranslationRequest): Promise<KeyValueTranslationResponse> {
    if (!this.isConfigured()) {
      return {
        translations: this.convertToNestedJson(request.entries),
        success: false,
        error: 'OpenAI is not configured. Please check your settings.'
      };
    }

    const config = ConfigManager.getConfig();
    const apiKey = config.openai?.apiKey;
    const model = config.openai?.model || 'gpt-3.5-turbo';

    try {
      const languageNames = this.getLanguageNames();
      const sourceLang = request.sourceLanguage || 'en';
      const targetLangName = languageNames[request.targetLanguage] || request.targetLanguage;
      const sourceLangName = languageNames[sourceLang] || sourceLang;

      // Format input for OpenAI
      const formattedEntries = Object.entries(request.entries)
        .map(([key, value]) => `${key}="${value}"`)
        .join('\n');

      const systemPrompt = `You are a professional translator. You will receive translation key-value pairs in a specific format and need to translate them to ${targetLangName}.

Rules:
- Input format: key.path.foo="text"
- Output format: key.path.foo="translated text"
- Maintain the exact same key structure
- Translate ONLY the text values (content inside quotes)
- Preserve special formatting, quotes, and placeholders in the text
- Use natural, user-friendly language for UI text
- Return ONLY the translated key-value pairs, no explanations

Example:
Input:
landing.address="Address"
landing.our="Our Services"

Output:
landing.address="Adres"
landing.our="Servislerimiz"`;

      const userPrompt = `Translate these key-value pairs from ${sourceLangName} to ${targetLangName}:

${formattedEntries}

Return the translations in the same format with translated text values.`;

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
          max_tokens: 2000,
          temperature: 0.2
        })
      });

      if (!response.ok) {
        const errorData = await response.json() as any;
        this.handleAPIError(response, errorData);
      }

      const data = await response.json() as any;
      const translationsText = data.choices[0]?.message?.content?.trim();

      if (!translationsText) {
        throw new Error('No translation received from OpenAI');
      }

      // Parse the key-value pairs from OpenAI response
      const translatedEntries = this.parseKeyValueResponse(translationsText);
      
      // Convert to nested JSON structure
      const nestedTranslations = this.convertToNestedJson(translatedEntries);

      return {
        translations: nestedTranslations,
        success: true
      };

    } catch (error) {
      console.error('OpenAI key-value translation error:', error);
      
      // Fallback to original values
      const fallbackTranslations = this.convertToNestedJson(request.entries);
      
      return {
        translations: fallbackTranslations,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * Parse key-value response from OpenAI
   * Input: 'landing.address="Adres"\nlanding.our="Servislerimiz"'
   * Output: { "landing.address": "Adres", "landing.our": "Servislerimiz" }
   */
  private static parseKeyValueResponse(response: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = response.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const match = line.match(/^([^=]+)="([^"]*)"$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2];
        result[key] = value;
      }
    }

    return result;
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
   * Handle OpenAI API response errors with specific error types
   */
  private static handleAPIError(response: Response, errorData: any): never {
    const errorMessage = errorData.error?.message || response.statusText;
    const errorCode = errorData.error?.code;
    
    // Special handling for quota errors
    if (response.status === 429 || errorCode === 'insufficient_quota' || errorMessage.includes('quota')) {
      throw new Error(`🚫 `+ errorMessage);
    }
    
    // Special handling for rate limits
    if (response.status === 429 || errorCode === 'rate_limit_exceeded') {
      throw new Error(`⏱️ `+ errorMessage);
    }
    
    // Special handling for invalid API key
    if (response.status === 401 || errorCode === 'invalid_api_key') {
      throw new Error(`🔑 `+ errorMessage);
    }
    
    // Special handling for model not found
    if (response.status === 404 || errorCode === 'model_not_found') {
      throw new Error(`🤖 `+ errorMessage);
    }
    
    // Special handling for context length exceeded
    if (errorCode === 'context_length_exceeded') {
      throw new Error(`📏 ` + errorMessage);
    }
    
    throw new Error(`OpenAI API error: ${errorMessage}`);
  }
}
