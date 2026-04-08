import { google, type Auth, type docs_v1 } from "googleapis";

/**
 * Creates a Google Doc in the given folder with the transcription text.
 * Optionally adds a formatted header with assignment name and due date.
 * Returns the doc ID and URL.
 */
export async function createGoogleDoc(
  authClient: Auth.OAuth2Client,
  title: string,
  bodyText: string,
  folderId: string,
  headerInfo?: { assignmentTitle: string; dueDate: string | null }
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
  const docs = google.docs({ version: "v1", auth: authClient });

  const requests: docs_v1.Schema$Request[] = [];

  if (headerInfo) {
    // Build header text
    const headerLines: string[] = [headerInfo.assignmentTitle];
    if (headerInfo.dueDate) {
      headerLines.push(
        `Due: ${new Date(headerInfo.dueDate).toLocaleDateString()}`
      );
    }
    const headerText = headerLines.join("\n") + "\n\n";

    // Insert body text at index 1, then header at index 1 (pushes body down)
    requests.push(
      { insertText: { location: { index: 1 }, text: bodyText } },
      { insertText: { location: { index: 1 }, text: headerText } },
      {
        updateTextStyle: {
          range: { startIndex: 1, endIndex: 1 + headerText.length },
          textStyle: {
            bold: true,
            fontSize: { magnitude: 14, unit: "PT" },
          },
          fields: "bold,fontSize",
        },
      }
    );
  } else {
    requests.push({
      insertText: { location: { index: 1 }, text: bodyText },
    });
  }

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });

  return {
    docId,
    docUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
}
