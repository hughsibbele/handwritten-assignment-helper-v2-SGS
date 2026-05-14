/**
 * Peer envelope contract — mirrors super-grader's planning/integration-contract.md
 * §4 (the result payload) and packages/peers/src/index.ts (the HandwrittenSummary
 * shape). Kept identical here so the GET endpoint and the outbound webhook
 * serialize the same JSON super-grader's validator expects.
 */

export type HandwrittenSummary = {
  transcript?: string | null;
  canvas_submission_text?: string | null;
  google_doc_url?: string | null;
  page_count?: number | null;
  source_tag?: "handwritten_helper";
};

export type HandwrittenEnvelope = {
  schema_version: 1;
  peer: "handwritten";
  canvas_user_id: string;
  canvas_assignment_id: string;
  anon_token: string;
  completed_at: string;
  summary: HandwrittenSummary;
  links?: {
    detail_url?: string;
  };
};
