import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';
import { logger } from '../common/logger';

let geminiClient: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!geminiClient) {
    if (!env.GEMINI_API_KEY) {
      logger.warn('GEMINI_API_KEY is not defined. Copilot will use fallback responses.');
    }

    geminiClient = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY || 'PLACEHOLDER_KEY',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  return geminiClient;
}
