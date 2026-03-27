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
}

export interface CanvasUser {
  id: number;
  name: string;
  email?: string;
  login_id?: string;
}
