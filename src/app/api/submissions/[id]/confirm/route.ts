import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStudentGoogleClient } from "@/lib/google/auth";
import { createGoogleDoc } from "@/lib/google/docs";
import { getOrCreateCourseFolder } from "@/lib/google/drive";
import { CanvasClient } from "@/lib/canvas/client";
import { z } from "zod";

/** Convert plain text to simple HTML paragraphs for Canvas. */
function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

const bodySchema = z.object({
  transcriptionText: z.string().min(1),
  submitToCanvas: z.boolean().default(false),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: submissionId } = await params;
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Admin client required: student needs teacher's Canvas credentials (cross-role access)
  const admin = createAdminClient();

  // Fetch submission with related data needed for doc creation + Canvas submission
  const { data: submission } = await admin
    .from("submissions")
    .select(
      `
      id,
      student_id,
      assignment_id,
      students!inner ( auth_user_id, display_name, canvas_user_id ),
      assignments!inner (
        title,
        due_date,
        course_id,
        canvas_assignment_id,
        canvas_submission_types,
        canvas_discussion_topic_id,
        courses!inner (
          name,
          short_name,
          canvas_course_id,
          teacher_id,
          teachers!inner ( email, canvas_base_url, canvas_api_token )
        )
      )
    `
    )
    .eq("id", submissionId)
    .single();

  if (!submission) {
    return NextResponse.json(
      { error: "Submission not found" },
      { status: 404 }
    );
  }

  // Verify the submission belongs to this user
  const student = submission.students as unknown as {
    auth_user_id: string;
    display_name: string;
    canvas_user_id: number | null;
  };
  if (student.auth_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const assignment = submission.assignments as unknown as {
    title: string;
    due_date: string | null;
    course_id: string;
    canvas_assignment_id: number | null;
    canvas_submission_types: string[] | null;
    canvas_discussion_topic_id: number | null;
    courses: {
      name: string;
      short_name: string | null;
      canvas_course_id: number;
      teacher_id: string;
      teachers: {
        email: string;
        canvas_base_url: string | null;
        canvas_api_token: string | null;
      };
    };
  };
  const teacherEmail = assignment.courses.teachers.email;
  const courseShortName =
    assignment.courses.short_name ?? assignment.courses.name;

  // Look up the enrollment for this student + course
  const { data: enrollment } = await admin
    .from("enrollments")
    .select("id")
    .eq("student_id", submission.student_id)
    .eq("course_id", assignment.course_id)
    .single();

  if (!enrollment) {
    return NextResponse.json(
      { error: "Student not enrolled in this course" },
      { status: 400 }
    );
  }

  // Update submission text first (even if doc/Canvas fails, text is saved)
  const { error: updateError } = await admin
    .from("submissions")
    .update({
      transcription_text: parsed.data.transcriptionText,
      submit_to_canvas: parsed.data.submitToCanvas,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", submissionId);

  if (updateError) {
    return NextResponse.json(
      { error: "Failed to confirm submission" },
      { status: 500 }
    );
  }

  const warnings: string[] = [];

  // Create Google Doc in student's Drive
  let gdocUrl: string | null = null;
  try {
    const googleClient = await getStudentGoogleClient(submission.student_id);

    const folderId = await getOrCreateCourseFolder(
      googleClient,
      enrollment.id,
      courseShortName,
      student.display_name,
      teacherEmail
    );

    const dateStr = new Date().toISOString().slice(0, 10);
    const docTitle = `${assignment.title} - ${student.display_name} (${dateStr})`;
    const { docId, docUrl } = await createGoogleDoc(
      googleClient,
      docTitle,
      parsed.data.transcriptionText,
      folderId,
      { assignmentTitle: assignment.title, dueDate: assignment.due_date }
    );

    gdocUrl = docUrl;

    await admin
      .from("submissions")
      .update({
        gdoc_id: docId,
        gdoc_url: docUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", submissionId);
  } catch (err) {
    console.error("Google Doc creation failed:", err);
    warnings.push(
      "Google Doc creation failed. You may need to re-login with Google."
    );
  }

  // Canvas submission (independent of Google Doc — uses transcription text directly)
  let canvasSubmitted = false;
  let canvasSubmissionUrl: string | null = null;
  if (parsed.data.submitToCanvas) {
    try {
      const teacher = assignment.courses.teachers;
      if (!teacher.canvas_base_url || !teacher.canvas_api_token) {
        warnings.push("Canvas not configured for this teacher.");
      } else if (!student.canvas_user_id) {
        warnings.push(
          "Your account isn't linked to Canvas yet — Canvas submission skipped."
        );
      } else if (!assignment.canvas_assignment_id) {
        warnings.push("This assignment isn't linked to Canvas.");
      } else {
        const canvas = new CanvasClient(
          teacher.canvas_base_url,
          teacher.canvas_api_token
        );

        const isDiscussion = !!assignment.canvas_discussion_topic_id;
        const submissionTypes = assignment.canvas_submission_types ?? [];
        const supportsTextEntry =
          submissionTypes.includes("online_text_entry");

        const htmlBody = textToHtml(parsed.data.transcriptionText);

        if (isDiscussion && assignment.canvas_discussion_topic_id) {
          // Post as a discussion entry
          await canvas.postDiscussionEntry(
            assignment.courses.canvas_course_id,
            assignment.canvas_discussion_topic_id,
            student.canvas_user_id,
            htmlBody
          );
          canvasSubmitted = true;
          canvasSubmissionUrl = `${teacher.canvas_base_url}/courses/${assignment.courses.canvas_course_id}/discussion_topics/${assignment.canvas_discussion_topic_id}`;
        } else if (supportsTextEntry) {
          // Submit as text entry
          await canvas.submitTextEntry(
            assignment.courses.canvas_course_id,
            assignment.canvas_assignment_id,
            student.canvas_user_id,
            htmlBody
          );
          canvasSubmitted = true;
          canvasSubmissionUrl = `${teacher.canvas_base_url}/courses/${assignment.courses.canvas_course_id}/assignments/${assignment.canvas_assignment_id}/submissions/${student.canvas_user_id}`;
        } else {
          warnings.push(
            "This Canvas assignment doesn't accept text submissions — Canvas submission skipped."
          );
        }

        if (canvasSubmitted) {
          await admin
            .from("submissions")
            .update({
              status: "submitted",
              submitted_to_canvas_at: new Date().toISOString(),
              canvas_submission_url: canvasSubmissionUrl,
              updated_at: new Date().toISOString(),
            })
            .eq("id", submissionId);
        }
      }
    } catch (err) {
      console.error("Canvas submission failed:", err);
      warnings.push(
        `Canvas submission failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }
  }

  return NextResponse.json({
    success: true,
    gdocUrl,
    canvasSubmitted,
    canvasSubmissionUrl,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}
