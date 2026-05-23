import { NextResponse } from "next/server";
import { getServerDbClient } from "@/lib/supabase/server";
import { createAdminDbClient } from "@/lib/supabase/admin";
import { CanvasClient } from "@/lib/canvas/client";
import {
  buildHandwrittenCardBlock,
  removeCardBlock,
  replaceOrAppendCardBlock,
} from "@/lib/canvas/install";
import { resolveCardTextForTeacher } from "@/lib/card-text/resolve";

// POST  /api/teacher/assignments/<id>/install  → install the card
// DELETE /api/teacher/assignments/<id>/install  → uninstall the card
//
// Both operations: GET assignment description from Canvas, splice in (or
// strip) our marker block, PUT back. State table is updated in lockstep so
// the dashboard can show install status without re-querying Canvas.

type Ctx = { params: Promise<{ id: string }> };

async function loadContext(assignmentId: string) {
  const supabase = await getServerDbClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };

  const { data: teacher } = await supabase
    .from("teachers")
    .select("id, canvas_base_url, canvas_api_token")
    .eq("auth_user_id", user.id)
    .single();
  if (!teacher) return { error: "Teacher not found" as const, status: 404 };
  if (!teacher.canvas_base_url || !teacher.canvas_api_token) {
    return { error: "Canvas not configured" as const, status: 400 };
  }

  // Load assignment + parent course. RLS guarantees the teacher owns the
  // course (assignments are filtered through course.teacher_id), so a
  // not-found here means either bad id or wrong owner — both 404.
  const { data: assignment } = await supabase
    .from("assignments")
    .select(
      "id, canvas_assignment_id, course_id, courses!inner ( canvas_course_id )",
    )
    .eq("id", assignmentId)
    .single();
  if (!assignment) return { error: "Assignment not found" as const, status: 404 };

  const canvasCourseId = (
    assignment.courses as unknown as { canvas_course_id: number | null }
  )?.canvas_course_id;
  const canvasAssignmentId = assignment.canvas_assignment_id;
  if (!canvasCourseId || !canvasAssignmentId) {
    return {
      error: "Assignment is missing Canvas ids — re-sync from the dashboard" as const,
      status: 400,
    };
  }

  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (!appBaseUrl) {
    return { error: "NEXT_PUBLIC_APP_URL not set" as const, status: 500 };
  }

  return {
    teacher,
    assignment: {
      id: assignment.id,
      courseId: assignment.course_id as string,
      canvasCourseId,
      canvasAssignmentId,
    },
    appBaseUrl,
    canvas: new CanvasClient(teacher.canvas_base_url, teacher.canvas_api_token),
  };
}

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await loadContext(id);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let canvasDescription: string;
  try {
    const current = await ctx.canvas.getAssignment(
      ctx.assignment.canvasCourseId,
      ctx.assignment.canvasAssignmentId,
    );
    canvasDescription = current.description ?? "";
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Canvas read failed" },
      { status: 502 },
    );
  }

  // Pull effective per-teacher card text (M6.15). Falls all the way back
  // to DEFAULT_HANDWRITTEN_CARD_TEXT inside the resolver if the defaults
  // row is somehow missing.
  const cardText = await resolveCardTextForTeacher(ctx.teacher.id);

  const cardBlock = buildHandwrittenCardBlock({
    appBaseUrl: ctx.appBaseUrl,
    courseId: ctx.assignment.courseId,
    assignmentId: ctx.assignment.id,
    text: cardText,
  });

  const nextDescription = replaceOrAppendCardBlock(
    canvasDescription,
    cardBlock,
    { courseId: ctx.assignment.courseId, assignmentId: ctx.assignment.id },
  );

  try {
    await ctx.canvas.updateAssignment(
      ctx.assignment.canvasCourseId,
      ctx.assignment.canvasAssignmentId,
      { description: nextDescription },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Canvas write failed" },
      { status: 502 },
    );
  }

  const installUrl = `${ctx.appBaseUrl}/student/courses/${ctx.assignment.courseId}/assignments/${ctx.assignment.id}`;

  // Service-role upsert: RLS would otherwise re-evaluate the assignment-join
  // policy on every install which is fine but extra work; this matches how
  // other HAH install-side writes are done.
  const admin = createAdminDbClient();
  const { error: upsertErr } = await admin
    .from("assignment_install_state")
    .upsert(
      {
        assignment_id: ctx.assignment.id,
        canvas_install_url: installUrl,
        installed_by: ctx.teacher.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "assignment_id" },
    );
  if (upsertErr) {
    console.error("[teacher/install] state upsert failed", upsertErr);
    return NextResponse.json(
      { error: "Card written to Canvas but install state save failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    installed: true,
    canvas_install_url: installUrl,
  });
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const ctx = await loadContext(id);
  if ("error" in ctx) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let canvasDescription: string;
  try {
    const current = await ctx.canvas.getAssignment(
      ctx.assignment.canvasCourseId,
      ctx.assignment.canvasAssignmentId,
    );
    canvasDescription = current.description ?? "";
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Canvas read failed" },
      { status: 502 },
    );
  }

  const nextDescription = removeCardBlock(canvasDescription, {
    courseId: ctx.assignment.courseId,
    assignmentId: ctx.assignment.id,
  });

  if (nextDescription !== canvasDescription) {
    try {
      await ctx.canvas.updateAssignment(
        ctx.assignment.canvasCourseId,
        ctx.assignment.canvasAssignmentId,
        { description: nextDescription },
      );
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Canvas write failed" },
        { status: 502 },
      );
    }
  }

  const admin = createAdminDbClient();
  const { error: delErr } = await admin
    .from("assignment_install_state")
    .delete()
    .eq("assignment_id", ctx.assignment.id);
  if (delErr) {
    console.error("[teacher/install] state delete failed", delErr);
    return NextResponse.json(
      { error: "Card stripped from Canvas but state delete failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ installed: false });
}
