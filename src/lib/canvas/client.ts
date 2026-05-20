import {
  CanvasCourse,
  CanvasAssignment,
  CanvasUser,
  CanvasSubmissionResponse,
  CanvasDiscussionEntry,
} from "./types";

export class CanvasClient {
  constructor(
    private baseUrl: string,
    private token: string
  ) {}

  private async fetchPaginated<T>(
    path: string,
    params?: Record<string, string>
  ): Promise<T[]> {
    const results: T[] = [];
    let url = `${this.baseUrl}${path}?per_page=100`;
    if (params) {
      url += "&" + new URLSearchParams(params).toString();
    }

    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.token}` },
      });

      if (!res.ok) {
        throw new Error(`Canvas API error: ${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      results.push(...data);
      url = this.getNextPageUrl(res.headers.get("Link"));
    }

    return results;
  }

  private getNextPageUrl(linkHeader: string | null): string {
    if (!linkHeader) return "";
    const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    return match?.[1] ?? "";
  }

  async getCourses(): Promise<CanvasCourse[]> {
    return this.fetchPaginated<CanvasCourse>("/api/v1/courses", {
      enrollment_type: "teacher",
      include: "term",
      state: "available",
    });
  }

  async getAssignments(courseId: number): Promise<CanvasAssignment[]> {
    return this.fetchPaginated<CanvasAssignment>(
      `/api/v1/courses/${courseId}/assignments`
    );
  }

  async getAssignment(
    courseId: number,
    assignmentId: number,
  ): Promise<CanvasAssignment> {
    const url = `${this.baseUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`Canvas API error: ${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  /**
   * Update an assignment's description (or other editable fields). Uses
   * form-encoded body — Canvas's RCE accepts both JSON and form, but
   * form-encoded matches the shape AI Documenter uses for the install
   * flow and avoids any nested-object quoting surprises.
   */
  async updateAssignment(
    courseId: number,
    assignmentId: number,
    fields: { description?: string },
  ): Promise<CanvasAssignment> {
    const url = `${this.baseUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}`;
    const form = new URLSearchParams();
    if (fields.description !== undefined) {
      form.set("assignment[description]", fields.description);
    }
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Canvas assignment update failed (${res.status}): ${body}`,
      );
    }
    return res.json();
  }

  async getStudents(courseId: number): Promise<CanvasUser[]> {
    // Canvas's documented form is `include[]=email`; bare `include=email`
    // is silently ignored on some Canvas installs, causing user.email to
    // come back undefined and the caller to fall back to login_id (which
    // gets stored as a fake email — see students.email upsert below).
    return this.fetchPaginated<CanvasUser>(
      `/api/v1/courses/${courseId}/users`,
      {
        "enrollment_type[]": "student",
        "enrollment_state[]": "active",
        "include[]": "email",
      }
    );
  }

  /**
   * Submit a text entry to a Canvas assignment on behalf of a student.
   */
  async submitTextEntry(
    courseId: number,
    assignmentId: number,
    studentCanvasUserId: number,
    text: string
  ): Promise<CanvasSubmissionResponse> {
    const url = `${this.baseUrl}/api/v1/courses/${courseId}/assignments/${assignmentId}/submissions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        as_user_id: studentCanvasUserId,
        submission: {
          submission_type: "online_text_entry",
          body: text,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Canvas submission failed (${res.status}): ${body}`);
    }

    return res.json();
  }

  /**
   * Post a discussion entry on behalf of a student.
   */
  async postDiscussionEntry(
    courseId: number,
    topicId: number,
    studentCanvasUserId: number,
    message: string
  ): Promise<CanvasDiscussionEntry> {
    const url = `${this.baseUrl}/api/v1/courses/${courseId}/discussion_topics/${topicId}/entries`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        as_user_id: studentCanvasUserId,
        message,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Canvas discussion post failed (${res.status}): ${body}`);
    }

    return res.json();
  }
}
