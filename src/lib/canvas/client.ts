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

  async getStudents(courseId: number): Promise<CanvasUser[]> {
    return this.fetchPaginated<CanvasUser>(
      `/api/v1/courses/${courseId}/users`,
      { "enrollment_type[]": "student", include: "email" }
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
