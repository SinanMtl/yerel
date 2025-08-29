import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { TranslationEntry } from './types';

export class GoogleSheetsService {

  /**
   * Check if Google Sheets integration is configured and enabled
   */
  public static isConfigured(): boolean {
    const config = ConfigManager.getConfig();
    return !!(
      config.googleSheets?.enabled &&
      config.googleSheets?.serviceAccountJson &&
      config.googleSheets?.spreadsheetId
    );
  }

  /**
   * Validate service account JSON format
   */
  private static validateServiceAccountJson(jsonString: string): any {
    try {
      const serviceAccount = JSON.parse(jsonString);

      const requiredFields = [
        'client_email',
        'private_key',
        'project_id',
        'client_id'
      ];

      for (const field of requiredFields) {
        if (!serviceAccount[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      return serviceAccount;
    } catch (error) {
      throw new Error(`Invalid Service Account JSON: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Export all existing translations from locale files to Google Sheets
   */
  public static async exportAllLocaleFiles(): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Google Sheets integration is not properly configured');
    }

    const config = ConfigManager.getConfig();
    const localesPath = ConfigManager.getLocalesFullPath();

    if (!localesPath) {
      throw new Error('Could not determine locales path');
    }

    try {
      let allTranslations: Record<string, Record<string, string>> = {};
      let allKeys = new Set<string>();

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '📊 Exporting All Translations to Google Sheets',
        cancellable: false
      }, async (progress) => {
        progress.report({
          increment: 10,
          message: 'Reading locale files...'
        });

        // Read all locale files
        allTranslations = {};
        const fs = await import('fs');
        const path = await import('path');

        for (const lang of config.supportedLanguages) {
          const filePath = path.join(localesPath, `${lang}.json`);

          if (fs.existsSync(filePath)) {
            try {
              const content = fs.readFileSync(filePath, 'utf8');
              const translations = JSON.parse(content);

              // Flatten nested objects if any
              const flatTranslations = this.flattenTranslations(translations);
              allTranslations[lang] = flatTranslations;

              console.log(`✅ Read ${Object.keys(flatTranslations).length} translations from ${lang}.json`);
            } catch (error) {
              console.warn(`⚠️ Could not read ${lang}.json:`, error);
            }
          }
        }

        progress.report({
          increment: 20,
          message: 'Preparing data for export...'
        });

        // Collect all unique keys
        allKeys = new Set<string>();
        Object.values(allTranslations).forEach(langTranslations => {
          Object.keys(langTranslations).forEach(key => allKeys.add(key));
        });

        if (allKeys.size === 0) {
          throw new Error('No translations found in locale files');
        }

        // Convert to TranslationEntry format
        const entries: TranslationEntry[] = Array.from(allKeys).map(key => {
          const translations: Record<string, string> = {};

          // Get translation for each language
          Object.keys(allTranslations).forEach(lang => {
            translations[lang] = allTranslations[lang][key] || '';
          });

          return {
            key,
            translations
          };
        });

        progress.report({
          increment: 20,
          message: `Found ${entries.length} unique translation keys`
        });

        // Export to sheets
        progress.report({
          increment: 30,
          message: 'Exporting to Google Sheets...'
        });

        await this.exportToSheets(entries);

        progress.report({
          increment: 20,
          message: 'Finalizing export...'
        });
      });

      // Show comprehensive success message outside progress context
      const languageCount = Object.keys(allTranslations).length;
      const keyCount = allKeys.size;

      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${config.googleSheets!.spreadsheetId!}/edit`;
      const openAction = 'Open Spreadsheet';

      // Small delay to ensure progress completes
      await new Promise(resolve => setTimeout(resolve, 200));

      const choice = await vscode.window.showInformationMessage(
        `🎉 Successfully exported ${keyCount} translation keys in ${languageCount} languages to Google Sheets!`,
        openAction
      );

      if (choice === openAction) {
        vscode.env.openExternal(vscode.Uri.parse(spreadsheetUrl));
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      vscode.window.showErrorMessage(`❌ Failed to export all translations: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Flatten nested translation objects to dot notation
   */
  private static flattenTranslations(obj: any, prefix = ''): Record<string, string> {
    const flattened: Record<string, string> = {};

    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        const newKey = prefix ? `${prefix}.${key}` : key;

        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          Object.assign(flattened, this.flattenTranslations(obj[key], newKey));
        } else {
          flattened[newKey] = String(obj[key]);
        }
      }
    }

    return flattened;
  }

  /**
   * Export translation entries to Google Sheets
   */
  public static async exportToSheets(entries: TranslationEntry[]): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Google Sheets integration is not properly configured');
    }

    const config = ConfigManager.getConfig();

    try {
      // Validate service account JSON
      const serviceAccount = this.validateServiceAccountJson(config.googleSheets!.serviceAccountJson!);

      // Show progress
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: '📊 Exporting to Google Sheets',
        cancellable: false
      }, async (progress) => {
        progress.report({
          increment: 10,
          message: 'Initializing Google Sheets connection...'
        });

        // Dynamically import google APIs (since they are not in dependencies)
        let GoogleAuth, google;
        try {
          const googleapis = await import('googleapis');
          google = googleapis.google;
          GoogleAuth = google.auth.GoogleAuth;
        } catch (error) {
          throw new Error('Google APIs not installed. Please install: npm install googleapis');
        }

        progress.report({
          increment: 20,
          message: 'Authenticating with Google Sheets...'
        });

        // Create authentication
        const auth = new GoogleAuth({
          credentials: {
            client_email: serviceAccount.client_email,
            private_key: serviceAccount.private_key.replace(/\\n/g, '\n'),
            project_id: serviceAccount.project_id,
          },
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const authClient = await auth.getClient();
        const sheets = google.sheets({ version: 'v4', auth: auth });

        progress.report({
          increment: 30,
          message: 'Preparing translation data...'
        });

        // Prepare data for sheets
        const sheetData: string[][] = [];

        // Create header row with all languages
        const allLanguages = new Set<string>();
        entries.forEach(entry => {
          Object.keys(entry.translations).forEach(lang => allLanguages.add(lang));
        });
        const languageArray = Array.from(allLanguages).sort();
        sheetData.push(['Key', ...languageArray]);

        // Add translation rows
        entries.forEach(entry => {
          const row = [entry.key];
          languageArray.forEach(lang => {
            row.push(entry.translations[lang] || '');
          });
          sheetData.push(row);
        });

        progress.report({
          increment: 20,
          message: 'Writing data to spreadsheet...'
        });

        // Write to spreadsheet
        await sheets.spreadsheets.values.update({
          spreadsheetId: config.googleSheets!.spreadsheetId!,
          range: 'A1',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: sheetData,
          },
        } as any);

        progress.report({
          increment: 20,
          message: 'Finalizing export...'
        });
      });

      // Show success message with link outside progress context
      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${config.googleSheets!.spreadsheetId!}/edit`;
      const openAction = 'Open Spreadsheet';

      // Small delay to ensure progress completes
      await new Promise(resolve => setTimeout(resolve, 200));

      const choice = await vscode.window.showInformationMessage(
        `🎉 Successfully exported ${entries.length} translation(s) to Google Sheets!`,
        openAction
      );

      if (choice === openAction) {
        vscode.env.openExternal(vscode.Uri.parse(spreadsheetUrl));
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('googleapis')) {
        vscode.window.showErrorMessage(
          '❌ Google APIs not installed. Please run: npm install googleapis',
          'Open Terminal'
        ).then(choice => {
          if (choice === 'Open Terminal') {
            vscode.window.createTerminal().show();
          }
        });
      } else if (errorMessage.includes('Permission denied') || errorMessage.includes('not found')) {
        vscode.window.showErrorMessage(
          `❌ Google Sheets error: ${errorMessage}\n\n💡 Make sure to share the spreadsheet with the service account email: ${this.getServiceAccountEmail()}`
        );
      } else {
        vscode.window.showErrorMessage(`❌ Google Sheets export failed: ${errorMessage}`);
      }

      throw error;
    }
  }

  /**
   * Get service account email from config
   */
  private static getServiceAccountEmail(): string {
    const config = ConfigManager.getConfig();
    if (!config.googleSheets?.serviceAccountJson) {
      return 'No service account configured';
    }

    try {
      const serviceAccount = JSON.parse(config.googleSheets.serviceAccountJson);
      return serviceAccount.client_email || 'Unknown email';
    } catch (error) {
      return 'Invalid service account JSON';
    }
  }

  /**
   * Test Google Sheets connection
   */
  public static async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.isConfigured()) {
      return {
        success: false,
        message: 'Google Sheets integration is not properly configured. Please check your settings.'
      };
    }

    try {
      const config = ConfigManager.getConfig();
      const serviceAccount = this.validateServiceAccountJson(config.googleSheets!.serviceAccountJson!);

      return {
        success: true,
        message: `✅ Google Sheets configuration is valid. Service account: ${serviceAccount.client_email}`
      };
    } catch (error) {
      return {
        success: false,
        message: `❌ Configuration error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Show setup instructions
   */
  public static showSetupInstructions(): void {
    const message = `
📊 Google Sheets Integration Setup:

1️⃣ Google Cloud Console:
   • Go to https://console.cloud.google.com
   • Create/select a project
   • Enable Google Sheets API
   • Create a Service Account
   • Download JSON key file

2️⃣ VS Code Settings:
   • Open VS Code Settings (Cmd/Ctrl + ,)
   • Search for "yerel google sheets"
   • Enable "Google Sheets: Enabled"
   • Paste entire JSON content in "Service Account Json"
   • Add your Spreadsheet ID

3️⃣ Share Spreadsheet:
   • Share your Google Spreadsheet
   • Give Editor access to service account email
   • Email is found in the JSON (client_email field)

Need help? Check the extension documentation!
        `;

    vscode.window.showInformationMessage(
      'Google Sheets Integration Setup',
      'Show Instructions'
    ).then(choice => {
      if (choice === 'Show Instructions') {
        vscode.window.showInformationMessage(message.trim());
      }
    });
  }
}
