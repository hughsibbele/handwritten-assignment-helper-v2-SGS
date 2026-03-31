import { google, type Auth } from "googleapis";

/**
 * Creates a Google Doc in the given folder with the transcription text.
 * Returns the doc ID and URL.
 */
export async function createGoogleDoc(
  authClient: Auth.OAuth2Client,
  title: string,
  bodyText: string,
  folderId: string
): Promise<{ docId: string; docUrl: string }> {
  const drive = google.drive({ version: "v3", auth: authClient });

  // Create the doc as a file in the folder (Docs API can't set parents directly)
  const file = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.document",
      parents: [folderId],
    },
  });

  const docId = file.data.id!;

  // Insert the transcription text into the doc
  const docs = google.docs({ version: "v1", auth: authClient });
  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: bodyText,
          },
        },
      ],
    },
  });

  return {
    docId,
    docUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
}
