export type AssignmentRow = {
  id: string;
  title: string;
  due_date: string | null;
  canvas_assignment_id: number | null;
  canvas_submit_by_default: boolean;
  canvas_submission_types: string[] | null;
  canvas_discussion_topic_id: number | null;
  installed: boolean;
};

export type CourseGroup = {
  id: string;
  name: string;
  short_name: string | null;
  term: string | null;
  last_synced_at: string | null;
  studentCount: number;
  assignments: AssignmentRow[];
  installedCount: number;
};
