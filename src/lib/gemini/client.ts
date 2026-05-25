import { GoogleGenAI } from "@google/genai";

let _genAI: GoogleGenAI | null = null;

export function getGeminiClient() {
  if (!_genAI) {
    _genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  }
  return _genAI;
}
