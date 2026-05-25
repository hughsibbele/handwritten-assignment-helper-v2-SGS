import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
import { createAdminDbClient } from "@/lib/supabase/admin";
import { getStudentGoogleClient } from "@/lib/google/auth";
import { createGoogleDoc } from "@/lib/google/docs";
import { getOrCreateCourseFolder } from "@/lib/google/drive";
import { CanvasClient } from "@/lib/canvas/client";
import { anonToken } from "@/lib/anonymizer/token";
import { pushToSuperGrader } from "@/lib/peers/notify";
import { isAssignmentInSuperGraderScope } from "@/lib/super-grader/scope";
import { z } from "zod";

/** Convert plain text to simple HTML paragraphs for Canvas. */
function textToHtml(text: string): string {
  return text
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Sentinel marker super-grader's Canvas-scrape pipeline matches against
 * (regex: `<!--\s*handwritten:` per super-grader's planning/integration-contract.md
 * §12). Tagged submissions are skipped so super-grader uses the webhook
 * envelope as canonical instead of treating the auto-submitted body as
 * student-authored work.
 */
function withSentinelMarker(htmlBody: string, submissionId: string): string {
  return `<!-- handwritten:transcription v=1 submission-id=${submissionId} -->\n${htmlBody}`;
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
  const supabase = await getServerDbClient();
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
  const admin = createAdminDbClient();

  // Fetch submission with related data needed for doc creation + Canvas submission
  const { data: submission } = await admin
    .from("submissions")
    .select(
      `
      id,
      student_id,
      assignment_id,
      attempt_number,
      students!inner ( auth_user_id, display_name, canvas_user_id, email, anon_token ),
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
    email: string | null;
    anon_token: string | null;
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

  // M7.11 — preview mode: skip Drive auto-save and Canvas submission.
  // The teacher sees the transcription in the review screen; they can
  // optionally save to Drive via a manual button (not auto).
  const isPreview = Boolean(
    (submission as unknown as { is_preview?: boolean }).is_preview,
  );
  if (isPreview) {
    return NextResponse.json({
      canvasSubmitted: false,
      gdocUrl: null,
      canvasSubmissionUrl: null,
      warnings: ["Preview mode — no Canvas submission or Drive save."],
    });
  }

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
    const attemptNumber = (submission as unknown as { attempt_number: number }).attempt_number ?? 1;
    const attemptSuffix = attemptNumber > 1 ? ` (Resubmission ${attemptNumber})` : "";
    // M7.6: {assignment} – {date} – {course} (en-dashes, suite convention).
    // Drops student name — the folder is already per-student so it's redundant.
    // Adds course so titles stay legible after the folder is moved into a
    // teacher's shared multi-student space.
    const docTitle = `${assignment.title} – ${dateStr} – ${courseShortName}${attemptSuffix}`;
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

  // If super-grader is tracking this assignment, SG owns the Canvas post —
  // skip our own. Drive write above already ran (student-Drive ownership
  // is core to HAH; doesn't change with SG-scope). Fail-open: any lookup
  // error keeps us on the normal Canvas path so a transient SG outage
  // doesn't silently suppress student submissions.
  const sgScope = await isAssignmentInSuperGraderScope(
    assignment.canvas_assignment_id,
  );
  const routedViaSuperGrader = sgScope.in_scope;
  if (routedViaSuperGrader && parsed.data.submitToCanvas) {
    warnings.push(
      "This assignment is routed via super-grader — Canvas submission skipped here; your teacher will post the final version from super-grader.",
    );
  }

  // Canvas submission (independent of Google Doc — uses transcription text directly)
  let canvasSubmitted = false;
  let canvasSubmissionUrl: string | null = null;
  if (parsed.data.submitToCanvas && !routedViaSuperGrader) {
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
        const taggedBody = withSentinelMarker(htmlBody, submissionId);
        let asSentBody: string | null = null;

        if (isDiscussion && assignment.canvas_discussion_topic_id) {
          // Post as a discussion entry (no sentinel marker — super-grader's
          // scrape pipeline reads submission bodies, not discussion entries).
          await canvas.postDiscussionEntry(
            assignment.courses.canvas_course_id,
            assignment.canvas_discussion_topic_id,
            student.canvas_user_id,
            htmlBody
          );
          asSentBody = htmlBody;
          canvasSubmitted = true;
          canvasSubmissionUrl = `${teacher.canvas_base_url}/courses/${assignment.courses.canvas_course_id}/discussion_topics/${assignment.canvas_discussion_topic_id}`;
        } else if (supportsTextEntry) {
          // Submit as text entry with the sentinel marker prepended.
          await canvas.submitTextEntry(
            assignment.courses.canvas_course_id,
            assignment.canvas_assignment_id,
            student.canvas_user_id,
            taggedBody
          );
          asSentBody = taggedBody;
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
              canvas_submission_text: asSentBody,
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

  // Lazy anon_token backfill. Computed in Node from canvas_user_id + email,
  // persisted so the UNIQUE constraint surfaces a collision if one ever
  // occurs. Skipped for class-code students (no canvas_user_id) and when
  // the salt isn't configured.
  if (
    !student.anon_token &&
    student.canvas_user_id &&
    student.email &&
    process.env.SUPER_GRADER_SALT
  ) {
    try {
      const token = anonToken(student.canvas_user_id, student.email);
      const { error: backfillErr } = await admin
        .from("students")
        .update({ anon_token: token })
        .eq("id", submission.student_id);
      if (backfillErr) {
        console.error("[anon-token] backfill failed", {
          studentId: submission.student_id,
          error: backfillErr,
        });
      }
    } catch (err) {
      console.error("[anon-token] compute failed", err);
    }
  }

  // Fire-and-forget push to super-grader. Awaited so failures land in logs,
  // but errors are swallowed inside pushToSuperGrader — never blocks the
  // student-visible response. Only meaningful for Canvas students; for
  // class-code-only students the envelope can't be built and we skip.
  if (student.canvas_user_id && assignment.canvas_assignment_id) {
    await pushToSuperGrader(
      student.canvas_user_id,
      assignment.canvas_assignment_id,
    );
  }

  return NextResponse.json({
    success: true,
    gdocUrl,
    canvasSubmitted,
    canvasSubmissionUrl,
    warnings: warnings.length > 0 ? warnings : undefined,
  });
}
