export interface CanvasCourse {
  id: number;
  name: string;
  enrollment_term_id?: number;
  term?: { name: string };
  workflow_state: string;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  description?: string;
  due_at?: string;
  points_possible?: number;
  published: boolean;
  submission_types?: string[];
  discussion_topic?: { id: number };
  is_quiz_assignment?: boolean;
}

export interface CanvasSubmissionResponse {
  id: number;
  assignment_id: number;
  user_id: number;
  submitted_at: string;
}

export interface CanvasDiscussionEntry {
  id: number;
  user_id: number;
  message: string;
  created_at: string;
}

export interface CanvasUser {
  id: number;
  name: string;
  email?: string;
  login_id?: string;
}
