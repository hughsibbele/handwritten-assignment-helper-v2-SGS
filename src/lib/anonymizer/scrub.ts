/**
 * Roster-driven name scrubber. Builds a single regex from the course's
 * student names, with the common variants the contract calls for:
 * full, first-only, last-only, possessive (Name's, Name's), and apostrophe
 * forms. Whole-word matching only — won't smash "Will" inside "willing".
 *
 * Replacement is the student's anon_token, so a Hugh Koeze in two-different
 * sentences becomes the same Student_xxxxxx everywhere.
 *
 * Compile once per (course_id, roster signature) via buildScrubber(); the
 * caller decides cache lifetime. The integration contract calls for ~5 min
 * in-process; see roster.ts.
 */

export type RosterEntry = {
  display_name: string;
  anon_token: string;
};

type Pattern = { regex: RegExp; token: string };

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function namePartsOf(displayName: string): string[] {
  // Split on whitespace, dash, and apostrophe so "Mary-Beth O'Hara" yields
  // ["Mary", "Beth", "O", "Hara"]. Strip 1-char and obviously-non-name parts.
  return displayName
    .split(/[\s\-']+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2 && /^[A-Za-z]/.test(p));
}

export function buildScrubber(roster: RosterEntry[]): (text: string) => string {
  const patterns: Pattern[] = [];

  for (const entry of roster) {
    if (!entry.anon_token || !entry.display_name) continue;
    const full = entry.display_name.trim();
    const parts = namePartsOf(full);
    if (parts.length === 0) continue;

    // Full name (and possessive form) — most specific, run first.
    patterns.push({
      regex: new RegExp(
        `\\b${escapeRegex(full)}(?:['’]s)?\\b`,
        "gi",
      ),
      token: entry.anon_token,
    });

    // Each individual part — first name, last name, middle bits. Short or
    // common-word parts ("Lee", "May") will produce false positives; the
    // tradeoff is accepted because the contract's threat model is FERPA-grade
    // PII leakage to Gemini, not English-prose preservation. Egress only.
    for (const part of parts) {
      patterns.push({
        regex: new RegExp(
          `\\b${escapeRegex(part)}(?:['’]s)?\\b`,
          "gi",
        ),
        token: entry.anon_token,
      });
    }
  }

  // Longer patterns first so "Hugh Koeze" matches before bare "Hugh".
  patterns.sort((a, b) => b.regex.source.length - a.regex.source.length);

  return (text: string): string => {
    if (!text) return text;
    let result = text;
    for (const { regex, token } of patterns) {
      result = result.replace(regex, token);
    }
    return result;
  };
}
