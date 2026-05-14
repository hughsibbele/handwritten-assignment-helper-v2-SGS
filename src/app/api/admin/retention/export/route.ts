import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Proxy enforces ADMIN_EMAILS for /api/admin/* — no per-route auth check.

// Escape a single CSV field per RFC 4180: wrap in quotes, double any embedded
// quote, normalize newlines. Null/undefined → empty string.
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const before = url.searchParams.get("before");

  const admin = createAdminClient();
  let query = admin
    .from("submissions")
    .select(
      `id, status, created_at, confirmed_at, submitted_to_canvas_at,
       transcription_text, canvas_submission_text, canvas_submission_url,
       gdoc_url, attempt_number,
       students!inner ( display_name, email, canvas_user_id ),
       assignments!inner (
         title, canvas_assignment_id,
         courses!inner ( name, short_name, canvas_course_id )
       )`,
    )
    .order("created_at", { ascending: false });

  if (before) {
    query = query.lt("created_at", before);
  }

  const { data: rows, error } = await query;
  if (error) {
    console.error("[admin/retention/export] query failed", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }

  type Row = {
    id: string;
    status: string;
    created_at: string;
    confirmed_at: string | null;
    submitted_to_canvas_at: string | null;
    transcription_text: string | null;
    canvas_submission_text: string | null;
    canvas_submission_url: string | null;
    gdoc_url: string | null;
    attempt_number: number | null;
    students: {
      display_name: string;
      email: string | null;
      canvas_user_id: number | null;
    };
    assignments: {
      title: string;
      canvas_assignment_id: number | null;
      courses: {
        name: string;
        short_name: string | null;
        canvas_course_id: number;
      };
    };
  };

  const headers = [
    "submission_id",
    "status",
    "created_at",
    "confirmed_at",
    "submitted_to_canvas_at",
    "attempt_number",
    "student_name",
    "student_email",
    "canvas_user_id",
    "course_name",
    "course_short_name",
    "canvas_course_id",
    "assignment_title",
    "canvas_assignment_id",
    "transcription_text",
    "canvas_submission_text",
    "canvas_submission_url",
    "gdoc_url",
  ];

  const lines: string[] = [headers.map(csvField).join(",")];
  for (const r of (rows as unknown as Row[] | null) ?? []) {
    lines.push(
      [
        r.id,
        r.status,
        r.created_at,
        r.confirmed_at,
        r.submitted_to_canvas_at,
        r.attempt_number,
        r.students.display_name,
        r.students.email,
        r.students.canvas_user_id,
        r.assignments.courses.name,
        r.assignments.courses.short_name,
        r.assignments.courses.canvas_course_id,
        r.assignments.title,
        r.assignments.canvas_assignment_id,
        r.transcription_text,
        r.canvas_submission_text,
        r.canvas_submission_url,
        r.gdoc_url,
      ]
        .map(csvField)
        .join(","),
    );
  }

  // ﻿ = UTF-8 BOM. Excel-on-Windows reads CSV as the system codepage
  // (cp1252 etc.) without it, which mangles curly quotes / accented names /
  // em-dashes in student work. The BOM costs 3 bytes and fixes the whole class.
  const body = "﻿" + lines.join("\n") + "\n";

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="hah-submissions-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
