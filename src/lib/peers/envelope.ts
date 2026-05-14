import { createAdminClient } from "@/lib/supabase/admin";
import { anonToken } from "@/lib/anonymizer/token";
import { getCourseScrubber } from "@/lib/anonymizer/roster";
import type { HandwrittenEnvelope } from "./types";

type SubmissionRow = {
  id: string;
  confirmed_at: string | null;
  submitted_to_canvas_at: string | null;
  transcription_text: string | null;
  canvas_submission_text: string | null;
  gdoc_url: string | null;
  status: string;
  students: {
    canvas_user_id: number | null;
    email: string | null;
  } | null;
  assignments: {
    course_id: string;
    canvas_assignment_id: number | null;
  } | null;
};

/**
 * Compose the outbound envelope for one (canvas_user_id, canvas_assignment_id)
 * pair. Returns null when no confirmed submission exists — the caller turns
 * that into a 404 (GET endpoint) or a skip (outbound webhook).
 *
 * Transcript fields are roster-scrubbed before they leave the boundary. The
 * stored `transcription_text` keeps the student's real name intact (it's
 * their own work shown back to them); only what we hand to super-grader
 * gets anonymized.
 */
export async function buildEnvelopeForCanvasIds(
  canvasUserId: number,
  canvasAssignmentId: number,
): Promise<HandwrittenEnvelope | null> {
  const admin = createAdminClient();

  // students.canvas_user_id is UNIQUE; one row per Canvas user.
  const { data: studentRows } = await admin
    .from("students")
    .select("id, canvas_user_id, email")
    .eq("canvas_user_id", canvasUserId)
    .limit(1);

  const student = (studentRows ?? [])[0];
  if (!student?.email) return null;

  // (course_id, canvas_assignment_id) is not unique across courses — one
  // teacher may have synced the same Canvas assignment under two courses
  // (rare but possible). We pick the student's submission, which scopes
  // implicitly to whichever course they're enrolled in.
  const { data: subs } = await admin
    .from("submissions")
    .select(
      `id, status, confirmed_at, submitted_to_canvas_at, transcription_text,
       canvas_submission_text, gdoc_url,
       assignments!inner ( course_id, canvas_assignment_id )`,
    )
    .eq("student_id", student.id)
    .in("status", ["confirmed", "submitted"])
    .order("confirmed_at", { ascending: false })
    .limit(50);

  type Sub = {
    id: string;
    status: string;
    confirmed_at: string | null;
    submitted_to_canvas_at: string | null;
    transcription_text: string | null;
    canvas_submission_text: string | null;
    gdoc_url: string | null;
    assignments: {
      course_id: string;
      canvas_assignment_id: number | null;
    };
  };

  const matchingSub = ((subs as unknown as Sub[] | null) ?? []).find(
    (s) => s.assignments.canvas_assignment_id === canvasAssignmentId,
  );
  if (!matchingSub) return null;

  // Anonymize via the course roster (cached 5 min).
  const scrub = await getCourseScrubber(matchingSub.assignments.course_id);

  // Count pages on demand — cheap (one COUNT per envelope, only built when
  // super-grader actually asks for this submission).
  const { count: pageCount } = await admin
    .from("submission_photos")
    .select("id", { count: "exact", head: true })
    .eq("submission_id", matchingSub.id);

  const completedAt =
    matchingSub.confirmed_at ??
    matchingSub.submitted_to_canvas_at ??
    new Date().toISOString();

  const sub: SubmissionRow = {
    id: matchingSub.id,
    confirmed_at: matchingSub.confirmed_at,
    submitted_to_canvas_at: matchingSub.submitted_to_canvas_at,
    transcription_text: matchingSub.transcription_text,
    canvas_submission_text: matchingSub.canvas_submission_text,
    gdoc_url: matchingSub.gdoc_url,
    status: matchingSub.status,
    students: { canvas_user_id: canvasUserId, email: student.email },
    assignments: {
      course_id: matchingSub.assignments.course_id,
      canvas_assignment_id: canvasAssignmentId,
    },
  };

  return {
    schema_version: 1,
    peer: "handwritten",
    canvas_user_id: String(canvasUserId),
    canvas_assignment_id: String(canvasAssignmentId),
    anon_token: anonToken(canvasUserId, student.email),
    completed_at: completedAt,
    summary: {
      transcript: sub.transcription_text ? scrub(sub.transcription_text) : null,
      canvas_submission_text: sub.canvas_submission_text
        ? scrub(sub.canvas_submission_text)
        : null,
      google_doc_url: sub.gdoc_url,
      page_count: pageCount ?? null,
      source_tag: "handwritten_helper",
    },
  };
}
