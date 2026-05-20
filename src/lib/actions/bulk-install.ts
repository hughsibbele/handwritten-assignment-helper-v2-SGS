"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CanvasClient } from "@/lib/canvas/client";
import {
  buildHandwrittenCardBlock,
  removeCardBlock,
  replaceOrAppendCardBlock,
} from "@/lib/canvas/install";
import { resolveCardTextForTeacher } from "@/lib/card-text/resolve";

/**
 * M6.18b: deliverable-destination triple. Each independent — any
 * combination including all three is valid. HAH's Drive box is locked-on
 * in the UI (student-Drive is the core feature) but stored explicitly so
 * the data model matches AID/OE.
 */
export type Destination = {
  drive: boolean;
  comment: boolean;
  submission: boolean;
};

export type BulkResult = {
  results: Array<{
    assignmentId: string;
    ok: boolean;
    message?: string;
  }>;
  successCount: number;
  failureCount: number;
};

/**
 * Multi-assignment install. Writes destination to each row + splices the
 * Canvas card into each assignment's description sequentially (Canvas
 * dislikes burst writes per-token, and per-assignment latency is small).
 *
 * Returns per-assignment results so the bar can show which ones succeeded /
 * which failed without rolling everything back.
 */
export async function bulkInstallAssignments(
  courseId: string,
  assignmentIds: string[],
  destination: Destination,
): Promise<BulkResult> {
  if (assignmentIds.length === 0) {
    return { results: [], successCount: 0, failureCount: 0 };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failAll(assignmentIds, "Not signed in");

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, canvas_base_url, canvas_api_token")
    .eq("auth_user_id", user.id)
    .single();
  if (!teacher) return failAll(assignmentIds, "Teacher not found");
  if (!teacher.canvas_base_url || !teacher.canvas_api_token) {
    return failAll(assignmentIds, "Canvas not configured");
  }

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (!appBaseUrl) {
    return failAll(assignmentIds, "NEXT_PUBLIC_APP_URL is not set");
  }

  // Resolve per-teacher card text once — same text used across the whole
  // bulk install.
  const cardText = await resolveCardTextForTeacher(teacher.id);

  const canvas = new CanvasClient(teacher.canvas_base_url, teacher.canvas_api_token);
  const admin = createAdminClient();

  const results: BulkResult["results"] = [];
  for (const id of assignmentIds) {
    try {
      await installOne({
        admin,
        canvas,
        teacherId: teacher.id,
        courseId,
        assignmentId: id,
        destination,
        cardText,
        appBaseUrl,
      });
      results.push({ assignmentId: id, ok: true });
    } catch (err) {
      results.push({
        assignmentId: id,
        ok: false,
        message: err instanceof Error ? err.message : "Install failed",
      });
    }
  }

  revalidatePath("/teacher/dashboard");
  return {
    results,
    successCount: results.filter((r) => r.ok).length,
    failureCount: results.filter((r) => !r.ok).length,
  };
}

export async function bulkUninstallAssignments(
  courseId: string,
  assignmentIds: string[],
): Promise<BulkResult> {
  if (assignmentIds.length === 0) {
    return { results: [], successCount: 0, failureCount: 0 };
  }

  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failAll(assignmentIds, "Not signed in");

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, canvas_base_url, canvas_api_token")
    .eq("auth_user_id", user.id)
    .single();
  if (!teacher) return failAll(assignmentIds, "Teacher not found");
  if (!teacher.canvas_base_url || !teacher.canvas_api_token) {
    return failAll(assignmentIds, "Canvas not configured");
  }

  const canvas = new CanvasClient(teacher.canvas_base_url, teacher.canvas_api_token);
  const admin = createAdminClient();

  const results: BulkResult["results"] = [];
  for (const id of assignmentIds) {
    try {
      await uninstallOne({
        admin,
        canvas,
        courseId,
        assignmentId: id,
      });
      results.push({ assignmentId: id, ok: true });
    } catch (err) {
      results.push({
        assignmentId: id,
        ok: false,
        message: err instanceof Error ? err.message : "Uninstall failed",
      });
    }
  }

  revalidatePath("/teacher/dashboard");
  return {
    results,
    successCount: results.filter((r) => r.ok).length,
    failureCount: results.filter((r) => !r.ok).length,
  };
}

// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>;

async function installOne({
  admin,
  canvas,
  teacherId,
  courseId,
  assignmentId,
  destination,
  cardText,
  appBaseUrl,
}: {
  admin: AdminClient;
  canvas: CanvasClient;
  teacherId: string;
  courseId: string;
  assignmentId: string;
  destination: Destination;
  cardText: Awaited<ReturnType<typeof resolveCardTextForTeacher>>;
  appBaseUrl: string;
}) {
  // 1. Load the assignment row + its parent course so we have the Canvas ids.
  const { data: assignment } = await admin
    .from("assignments")
    .select(
      "id, canvas_assignment_id, course_id, courses!inner ( canvas_course_id, teacher_id )",
    )
    .eq("id", assignmentId)
    .single();
  if (!assignment) throw new Error("Assignment not found");

  const course = assignment.courses as unknown as {
    canvas_course_id: number | null;
    teacher_id: string;
  };
  if (course.teacher_id !== teacherId) {
    throw new Error("Assignment doesn't belong to this teacher");
  }
  if (!course.canvas_course_id || !assignment.canvas_assignment_id) {
    throw new Error("Assignment is missing Canvas ids — re-sync the course");
  }
  if (assignment.course_id !== courseId) {
    throw new Error("Assignment doesn't belong to the selected course");
  }

  // 2. Write destination to the assignments row (always — the picker controls
  //    behavior even if the card itself can't be installed for some reason).
  //    canvas_submit_by_default kept in sync with post_to_canvas_submission
  //    for one cycle; M6.18b-followup drops the legacy column.
  const { error: destErr } = await admin
    .from("assignments")
    .update({
      post_to_drive: destination.drive,
      post_to_canvas_comment: destination.comment,
      post_to_canvas_submission: destination.submission,
      canvas_submit_by_default: destination.submission,
    })
    .eq("id", assignmentId);
  if (destErr) throw new Error(`Persist destination failed: ${destErr.message}`);

  // 3. Read current Canvas description.
  const current = await canvas.getAssignment(
    course.canvas_course_id,
    assignment.canvas_assignment_id,
  );
  const canvasDescription = current.description ?? "";

  // 4. Build the marker-wrapped card with the resolved per-teacher text.
  const cardBlock = buildHandwrittenCardBlock({
    appBaseUrl,
    courseId,
    assignmentId,
    text: cardText,
  });

  const nextDescription = replaceOrAppendCardBlock(canvasDescription, cardBlock, {
    courseId,
    assignmentId,
  });

  if (nextDescription !== canvasDescription) {
    await canvas.updateAssignment(
      course.canvas_course_id,
      assignment.canvas_assignment_id,
      { description: nextDescription },
    );
  }

  // 5. Upsert install state row so the dashboard reflects the live card.
  const installUrl = `${appBaseUrl}/student/courses/${courseId}/assignments/${assignmentId}`;
  const { error: upsertErr } = await admin
    .from("assignment_install_state")
    .upsert(
      {
        assignment_id: assignmentId,
        canvas_install_url: installUrl,
        installed_by: teacherId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id" },
    );
  if (upsertErr) {
    throw new Error(`Card written but install-state save failed: ${upsertErr.message}`);
  }
}

async function uninstallOne({
  admin,
  canvas,
  courseId,
  assignmentId,
}: {
  admin: AdminClient;
  canvas: CanvasClient;
  courseId: string;
  assignmentId: string;
}) {
  const { data: assignment } = await admin
    .from("assignments")
    .select(
      "id, canvas_assignment_id, course_id, courses!inner ( canvas_course_id )",
    )
    .eq("id", assignmentId)
    .single();
  if (!assignment) throw new Error("Assignment not found");

  const course = assignment.courses as unknown as {
    canvas_course_id: number | null;
  };
  if (!course.canvas_course_id || !assignment.canvas_assignment_id) {
    throw new Error("Assignment is missing Canvas ids");
  }

  const current = await canvas.getAssignment(
    course.canvas_course_id,
    assignment.canvas_assignment_id,
  );
  const canvasDescription = current.description ?? "";

  const next = removeCardBlock(canvasDescription, { courseId, assignmentId });
  if (next !== canvasDescription) {
    await canvas.updateAssignment(
      course.canvas_course_id,
      assignment.canvas_assignment_id,
      { description: next },
    );
  }

  const { error: delErr } = await admin
    .from("assignment_install_state")
    .delete()
    .eq("assignment_id", assignmentId);
  if (delErr) {
    throw new Error(`Card stripped but state delete failed: ${delErr.message}`);
  }
}

function failAll(ids: string[], message: string): BulkResult {
  return {
    results: ids.map((id) => ({ assignmentId: id, ok: false, message })),
    successCount: 0,
    failureCount: ids.length,
  };
}
