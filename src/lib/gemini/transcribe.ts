import { getGeminiClient } from "./client";

const TRANSCRIPTION_SYSTEM_INSTRUCTION = `You are a handwriting transcription assistant for a school reading journal. Your job is to faithfully transcribe a student's handwritten work.

Rules:
- Transcribe the student's actual words as accurately as possible
- Fix obvious misreads (e.g., "tlie" → "the") only when you are confident the student wrote a common word and it was misread
- Preserve the student's vocabulary, grammar, and sentence structure even if imperfect — do NOT correct their writing
- Preserve paragraph breaks as they appear
- If you cannot read a word, write [illegible]
- If you are uncertain about a word, write it as your best guess followed by [?]
- Do not add any commentary, headers, or formatting beyond the transcription`;

export async function transcribeImage(
  imageBase64: string,
  mimeType: string
): Promise<string> {
  const genAI = getGeminiClient();
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-preview-05-20",
    systemInstruction: TRANSCRIPTION_SYSTEM_INSTRUCTION,
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType,
        data: imageBase64,
      },
    },
    { text: "Please transcribe this handwritten student work." },
  ]);

  const response = result.response;
  return response.text();
}
