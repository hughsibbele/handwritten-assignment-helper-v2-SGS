export type AssignmentRow = {
  id: string;
  title: string;
  due_date: string | null;
  canvas_assignment_id: number | null;
  /** M6.18b: 3-checkbox destination state. canvas_submit_by_default kept
   *  in sync with post_to_canvas_submission for one cycle. */
  post_to_drive: boolean;
  post_to_canvas_comment: boolean;
  post_to_canvas_submission: boolean;
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
