import { google, type Auth } from "googleapis";
// Admin client required: writes enrollment folder ID in cross-role context
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Extracts a last name from a display name like "Jane Smith" -> "Smith".
 */
function getLastName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Gets or creates a Google Drive folder for a student's enrollment in a course.
 * Folder is named using the teacher-set short name: "FLC - Smith".
 * Shares the folder with the teacher so all docs inside are automatically shared.
 * Stores the folder ID on the enrollment row for reuse.
 */
export async function getOrCreateCourseFolder(
  authClient: Auth.OAuth2Client,
  enrollmentId: string,
  courseShortName: string,
  studentDisplayName: string,
  teacherEmail: string
): Promise<string> {
  const supabase = createAdminClient();

  // Check if folder already exists on this enrollment
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("gdrive_folder_id")
    .eq("id", enrollmentId)
    .single();

  if (enrollment?.gdrive_folder_id) {
    return enrollment.gdrive_folder_id;
  }

  // Create a new folder
  const drive = google.drive({ version: "v3", auth: authClient });
  const folderName = `${courseShortName} - ${getLastName(studentDisplayName)}`;

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
    },
  });

  const folderId = folder.data.id!;

  // Share the folder with the teacher (editor so they can comment/organize)
  await drive.permissions.create({
    fileId: folderId,
    requestBody: {
      role: "writer",
      type: "user",
      emailAddress: teacherEmail,
    },
    // Don't send a notification email for every student folder
    sendNotificationEmail: false,
  });

  // Store the folder ID on the enrollment
  await supabase
    .from("enrollments")
    .update({
      gdrive_folder_id: folderId,
    })
    .eq("id", enrollmentId);

  return folderId;
}
