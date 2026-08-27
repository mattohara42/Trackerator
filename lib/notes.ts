/**
 * Sanitising for Send to Claude.
 *
 * The note a user types is committed into the target repository's `CLAUDE.md`
 * — a file whose whole purpose is to instruct an agent that will later run
 * against that repo with write access. That makes it the highest-consequence
 * untrusted input in the codebase, and it was previously the least validated:
 * `.trim()` and nothing else.
 *
 * The specific hazard is structural rather than lexical. `buildUpdatedClaudeMd`
 * formats a note as one list item under the notes heading, so a note carrying
 * newlines escapes that framing and can write *new* markdown headings — which
 * both breaks out of the section it was supposed to live in and lets a note
 * masquerade as document structure. Flattening to a single line is what closes
 * that, so it is enforced here rather than left to the caller.
 */

/**
 * Roughly a long paragraph. Long enough for a real thought, short enough that a
 * note can't become a megabyte commit.
 */
export const MAX_NOTE_LENGTH = 2000;

/**
 * Whitespace that would break the single-line framing — newlines, tabs, and the
 * Unicode line/paragraph separators — folded to spaces rather than stripped, so
 * wrapped text keeps its word boundaries instead of running together.
 */
const LINE_BREAKS = /[\r\n\t\v\f\u2028\u2029]+/g;

/**
 * Remaining C0/C1 control characters and the zero-width/bidi formatting marks.
 * These have no legitimate place in a note and several change how text renders
 * in an editor or terminal, which is exactly the wrong property for a file read
 * as instructions.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

const RUNS_OF_SPACE = / {2,}/g;

export class NoteError extends Error {}

/**
 * Returns the note as a single safe line, or throws `NoteError` when there is
 * nothing usable left. Throwing rather than returning `""` keeps the caller from
 * silently committing an empty bullet.
 */
export function sanitizeNote(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new NoteError("Note is required");
  }

  const flattened = raw
    .replace(LINE_BREAKS, " ")
    .replace(CONTROL_CHARS, "")
    .replace(RUNS_OF_SPACE, " ")
    .trim();

  if (!flattened) {
    throw new NoteError("Note is required");
  }
  if (flattened.length > MAX_NOTE_LENGTH) {
    throw new NoteError(
      `Note is too long (${flattened.length} characters, maximum ${MAX_NOTE_LENGTH})`
    );
  }
  return flattened;
}

const NOTES_HEADING = "## Notes from Trackerator";

/** True when `line` is the notes heading itself, rather than prose about it. */
function isNotesHeading(line: string): boolean {
  return line.trim() === NOTES_HEADING;
}

/** Markdown h1/h2, which is what ends the notes section. */
const SECTION_BREAK = /^#{1,2} /;

export function buildUpdatedClaudeMd(existingContent: string | null, note: string): string {
  // Sanitised here rather than trusted from the caller, so the single-line
  // framing below is a property of this function instead of a convention every
  // call site has to remember. A note carrying newlines would otherwise write
  // its own markdown headings straight into an agent's instruction file.
  const safeNote = sanitizeNote(note);
  const timestamp = new Date().toISOString().slice(0, 10);
  const entry = `- ${timestamp}: ${safeNote}`;

  if (!existingContent) {
    return `# CLAUDE.md\n\n${NOTES_HEADING}\n\n${entry}\n`;
  }

  const lines = existingContent.trimEnd().split("\n");

  // Matching the heading as a whole line matters more than it looks. A plain
  // substring test also matches a *mention* of the heading — and Trackerator's
  // own CLAUDE.md documents this very feature, quoting the heading mid-
  // sentence. That made every note sent to this repo look like it belonged to
  // an existing section, so it was appended bare to the end of the file under
  // whatever heading happened to be last.
  const headingAt = lines.findIndex(isNotesHeading);
  if (headingAt === -1) {
    return `${lines.join("\n")}\n\n${NOTES_HEADING}\n\n${entry}\n`;
  }

  // Append within the notes section rather than at the end of the file, so a
  // note stays under its own heading even when other sections follow it.
  let end = lines.length;
  for (let i = headingAt + 1; i < lines.length; i += 1) {
    if (SECTION_BREAK.test(lines[i])) {
      end = i;
      break;
    }
  }
  while (end > headingAt + 1 && lines[end - 1].trim() === "") end -= 1;

  lines.splice(end, 0, entry);
  return `${lines.join("\n")}\n`;
}
